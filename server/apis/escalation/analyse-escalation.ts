import {
  api,
  z,
  graphql,
  restApiIntegration,
} from "@superblocksteam/sdk-api";

// Integration IDs
const RISK_COMMON_BFF = "df44a1a6-0d90-483f-9e22-265df78e5250";
const AIRBOARD_NG_KYC = "e0e3a611-efb8-4d78-8952-794c07eb404a";
const RISK_KYB_AIRBOARD = "922d8ed8-0010-467e-b00a-84dff6f67f1a";
const COMPLIANCE_GRAPHQL = "2f4816e2-a676-4269-aa8a-2699a9fe5a91";
const POSTMONITORING_GRAPHQL = "aa32653b-9aad-4b93-8c62-ec680ede2c08";
const ISS_AIRBOARDNG_API = "90aed8ed-3f3f-47e8-9ac0-608f2f66a2c0";
const AIRBOARDNG_API = "29d50385-2822-4444-a83e-83db2519a0e6";
const ACCOUNT_SETTINGS = "25c0f7da-e324-4125-bdd9-4ce506dcac32";

// --- Routing categories (KYB added) ---
type RoutingCategory = "KYC" | "KYB" | "TM" | "PA Risk Ops" | "CS";
type RfiStatus = "Open" | "Closed" | "None";

// --- RFI customer messages ---
const RFI_MESSAGES: Record<RfiStatus, string> = {
  Open: "Please complete the outstanding verification request first. Once completed, the relevant team can continue the review.",
  Closed:
    "We have received the required response. The relevant team is reviewing the case.",
  None: "No open verification request is showing. The relevant team will check the current status.",
};

// --- Output schema ---
const RecommendationSchema = z.object({
  escalationPoint: z.string(),
  recommendedTeam: z.string(),
  currentStatus: z.string(),
  rfiStatus: z.enum(["Open", "Closed", "None"]),
  whatIsOutstanding: z.string(),
  customerMessage: z.string(),
  suggestedInternalAction: z.string(),
  supportingInfo: z.object({
    accountId: z.string(),
    userId: z.string().nullable(),
    email: z.string().nullable(),
    cardholderId: z.string().nullable(),
    cardId: z.string().nullable(),
    transactionId: z.string().nullable(),
    depositId: z.string().nullable(),
    payoutId: z.string().nullable(),
    kycStage: z.string().nullable(),
    watchlistSource: z.string().nullable(),
    owningEntity: z.string().nullable(),
    region: z.string().nullable(),
    // New fields from gap fix
    legalEntityId: z.string().nullable(),
    universalCaseSummary: z.string().nullable(),
    kybCaseStatus: z.string().nullable(),
    nsCasesSummary: z.string().nullable(),
    realtimeTmSummary: z.string().nullable(),
    mrmCaseSummary: z.string().nullable(),
    issuingTmSummary: z.string().nullable(),
    // Global watchlist fields
    globalWatchlistStatus: z.string().nullable(),
    globalWatchlistCategory: z.string().nullable(),
    globalWatchlistReason: z.string().nullable(),
  }),
  missingInputs: z.array(z.string()),
  conflicts: z.array(z.string()),
});

const OutputSchema = z.object({
  recommendation: RecommendationSchema.nullable(),
  error: z.string().nullable(),
});

// --- Helper: safe query wrapper ---
async function safeQuery<T>(
  fn: () => Promise<T>,
): Promise<T | null> {
  try {
    return await fn();
  } catch {
    return null;
  }
}

// Closed/terminal status sets
const CLOSED_STATUSES = new Set([
  "CLOSED",
  "COMPLETED",
  "REJECTED",
  "CANCELLED",
  "RESOLVED",
  "DISMISSED",
  "ARCHIVED",
]);

function isActive(status: string | null | undefined): boolean {
  if (!status) return false;
  return !CLOSED_STATUSES.has(status.toUpperCase());
}

export default api({
  name: "AnalyseEscalation",
  description:
    "Aggregates account, KYC, KYB, TM, PA, card, NS/watchlist and universal case data to route CS escalations",

  integrations: {
    risk_common_bff: graphql(RISK_COMMON_BFF),
    airboard_ng_kyc: graphql(AIRBOARD_NG_KYC),
    risk_kyb_airboard: graphql(RISK_KYB_AIRBOARD),
    compliance_graphql: graphql(COMPLIANCE_GRAPHQL),
    postmonitoring_graphql: graphql(POSTMONITORING_GRAPHQL),
    iss_airboardng_api: graphql(ISS_AIRBOARDNG_API),
    airboardng_api: restApiIntegration(AIRBOARDNG_API),
    account_settings: graphql(ACCOUNT_SETTINGS),
  },

  input: z.object({
    accountId: z.string(),
    airboardToken: z.string().nullable(),
    ticketContext: z.string().nullable(),
    userId: z.string().nullable(),
    email: z.string().nullable(),
    cardholderId: z.string().nullable(),
    cardId: z.string().nullable(),
    transactionId: z.string().nullable(),
    depositId: z.string().nullable(),
    payoutId: z.string().nullable(),
    cle: z.string().nullable(),
  }),

  output: OutputSchema,

  async run(ctx, input) {
    const { accountId } = input;

    // Derive auth headers per org knowledge
    const graphqlHeaders = input.airboardToken
      ? { Authorization: input.airboardToken }
      : undefined;
    const bearerHeaders = input.airboardToken
      ? { Authorization: `Bearer ${input.airboardToken}` }
      : undefined;

    if (!accountId || accountId.trim() === "") {
      return { recommendation: null, error: "Account ID is required." };
    }

    // ====================================================================
    // PHASE 1: All accountId-based queries + Legal Entity ID resolution
    // ====================================================================

    const [
      kycCasesResult,
      tmCasesResult,
      rfiSessionsResult,
      rfiListResult,
      accountDetailsResult,
      cardholdersResult,
      issuingAccountResult,
      watchlistResult,
      globalWatchlistResult,
      legalEntityResult,
    ] = await Promise.all([
      // 1. KYC cases via airboard-ng-kyc-service
      safeQuery(() =>
        ctx.integrations.airboard_ng_kyc.query(
          `query {
            getKycCases(param: { accountId: "${accountId}", pageNumber: 0, pageSize: 20 }) {
              kycCaseEntries {
                id
                primaryAccountId
                caseStatus
                owningEntity
                rfiStatus
                reviewType
                reviewStatus
                outcome
                openId
                email
                legalEntityId
              }
              hasMore
            }
          }`,
          {
            response: z.object({
              data: z
                .object({
                  getKycCases: z
                    .object({
                      kycCaseEntries: z.array(
                        z.object({
                          id: z.string(),
                          primaryAccountId: z.string().nullable().optional(),
                          caseStatus: z.string().nullable().optional(),
                          owningEntity: z.string().nullable().optional(),
                          rfiStatus: z.string().nullable().optional(),
                          reviewType: z.string().nullable().optional(),
                          reviewStatus: z.string().nullable().optional(),
                          outcome: z.string().nullable().optional(),
                          openId: z.string().nullable().optional(),
                          email: z.string().nullable().optional(),
                          legalEntityId: z.string().nullable().optional(),
                        }),
                      ),
                      hasMore: z.boolean().optional(),
                    })
                    .nullable(),
                })
                .nullable(),
            }),
          },
          {},
          { label: "Get KYC cases by account ID" },
          graphqlHeaders,
        ),
      ),

      // 2. TM cases via postmonitoring-graphql
      safeQuery(() =>
        ctx.integrations.postmonitoring_graphql.query(
          `query {
            listCases(query: { pageNum: 1, pageSize: 20, account: { uuid: "${accountId}" } }) {
              total
              cases {
                uuid
                status
                domains
                level
              }
            }
          }`,
          {
            response: z.object({
              data: z
                .object({
                  listCases: z
                    .object({
                      total: z.number(),
                      cases: z.array(
                        z.object({
                          uuid: z.string().nullable().optional(),
                          status: z.string().nullable().optional(),
                          domains: z.array(z.string()).nullable().optional(),
                          level: z.string().nullable().optional(),
                        }),
                      ),
                    })
                    .nullable(),
                })
                .nullable(),
            }),
          },
          {},
          { label: "List TM cases by account ID" },
          graphqlHeaders,
        ),
      ),

      // 3. RFI sessions via compliance-graphql
      safeQuery(() =>
        ctx.integrations.compliance_graphql.query(
          `query {
            getRFISessionList(request: { accountId: "${accountId}", statuses: [PENDING, ANSWERED, CLOSED] }) {
              hasNext
              values {
                id
                status
                accountId
                clientLegalEntityId
                type
              }
            }
          }`,
          {
            response: z.object({
              data: z
                .object({
                  getRFISessionList: z
                    .object({
                      hasNext: z.boolean().optional(),
                      values: z.array(
                        z.object({
                          id: z.string().nullable().optional(),
                          status: z.string().nullable().optional(),
                          accountId: z.string().nullable().optional(),
                          clientLegalEntityId: z.string().nullable().optional(),
                          type: z.string().nullable().optional(),
                        }),
                      ),
                    })
                    .nullable(),
                })
                .nullable(),
            }),
          },
          {},
          { label: "Get RFI sessions by account ID" },
          graphqlHeaders,
        ),
      ),

      // 4. RFI list via compliance-graphql
      safeQuery(() =>
        ctx.integrations.compliance_graphql.query(
          `query {
            getRFIList(query: { accountId: "${accountId}" }) {
              hasNext
              currentCount
              values {
                id
                status
                type
                accountId
              }
            }
          }`,
          {
            response: z.object({
              data: z
                .object({
                  getRFIList: z
                    .object({
                      hasNext: z.boolean().optional(),
                      currentCount: z.number().optional(),
                      values: z.array(
                        z.object({
                          id: z.string().nullable().optional(),
                          status: z.string().nullable().optional(),
                          type: z.string().nullable().optional(),
                          accountId: z.string().nullable().optional(),
                        }),
                      ),
                    })
                    .nullable(),
                })
                .nullable(),
            }),
          },
          {},
          { label: "Get RFI list by account ID" },
          graphqlHeaders,
        ),
      ),

      // 5. Account info via account-settings-airboard
      safeQuery(() =>
        ctx.integrations.account_settings.query(
          `query {
            account(id: "${accountId}") {
              id
              status
              owningEntity
              dataCenter
              businessName
            }
          }`,
          {
            response: z.object({
              data: z
                .object({
                  account: z
                    .object({
                      id: z.string().nullable().optional(),
                      status: z.string().nullable().optional(),
                      owningEntity: z.string().nullable().optional(),
                      dataCenter: z.string().nullable().optional(),
                      businessName: z.string().nullable().optional(),
                    })
                    .nullable(),
                })
                .nullable(),
            }),
          },
          {},
          { label: "Get account details" },
          graphqlHeaders,
        ),
      ),

      // 6. Cardholders via iss-airboardng-api
      safeQuery(() =>
        ctx.integrations.iss_airboardng_api.query(
          `query {
            getAllCardholders(filters: { accountId: "${accountId}" }, pageInfo: { pageNumber: 0, pageSize: 10 }) {
              hasMore
              items {
                id
                accountId
                status
                email
                type
              }
            }
          }`,
          {
            response: z.object({
              data: z
                .object({
                  getAllCardholders: z
                    .object({
                      hasMore: z.boolean().optional(),
                      items: z.array(
                        z.object({
                          id: z.string().nullable().optional(),
                          accountId: z.string().nullable().optional(),
                          status: z.string().nullable().optional(),
                          email: z.string().nullable().optional(),
                          type: z.string().nullable().optional(),
                        }),
                      ),
                    })
                    .nullable(),
                })
                .nullable(),
            }),
          },
          {},
          { label: "Get cardholders by account ID" },
          bearerHeaders,
        ),
      ),

      // 7. Issuing account details via iss-airboardng-api
      safeQuery(() =>
        ctx.integrations.iss_airboardng_api.query(
          `query {
            getAccountDetails(accountId: "${accountId}") {
              accountId
              awxOwningEntity
              businessName
              contactName
            }
          }`,
          {
            response: z.object({
              data: z
                .object({
                  getAccountDetails: z
                    .object({
                      accountId: z.string().nullable().optional(),
                      awxOwningEntity: z.string().nullable().optional(),
                      businessName: z.string().nullable().optional(),
                      contactName: z.string().nullable().optional(),
                    })
                    .nullable(),
                })
                .nullable(),
            }),
          },
          {},
          { label: "Get issuing account details" },
          bearerHeaders,
        ),
      ),

      // 8. Watchlist data via risk-common-bff (Account Linkage V3)
      safeQuery(() =>
        ctx.integrations.risk_common_bff.query(
          `query {
            getAccountLinkageInformationV3(accountId: "${accountId}", pageNumber: 0, pageSize: 20, watchListHits: true) {
              watchListHitsCount
              watchListCategories
              accountLinkageCounts
              total
              accountLinkageDetails {
                linkedCleId
                owningEntity
                businessName
                watchlistHit
                watchlistCategories
                kycStatus
                accStatuses
              }
            }
          }`,
          {
            response: z.object({
              data: z
                .object({
                  getAccountLinkageInformationV3: z
                    .object({
                      watchListHitsCount: z.number().nullable().optional(),
                      watchListCategories: z.array(z.string()).nullable().optional(),
                      accountLinkageCounts: z.number().nullable().optional(),
                      total: z.number().nullable().optional(),
                      accountLinkageDetails: z
                        .array(
                          z.object({
                            linkedCleId: z.string().nullable().optional(),
                            owningEntity: z.string().nullable().optional(),
                            businessName: z.string().nullable().optional(),
                            watchlistHit: z.boolean().nullable().optional(),
                            watchlistCategories: z.array(z.string()).nullable().optional(),
                            kycStatus: z.string().nullable().optional(),
                            accStatuses: z.array(z.string()).nullable().optional(),
                          }),
                        )
                        .nullable()
                        .optional(),
                    })
                    .nullable(),
                })
                .nullable(),
            }),
          },
          {},
          { label: "Get watchlist linkage data" },
          graphqlHeaders,
        ),
      ),

      // 9. Global Watchlist lookup via compliance-graphql (awxGlobalWatchList)
      safeQuery(() =>
        ctx.integrations.compliance_graphql.query(
          `query {
            isFieldInListWithMatchedElements(request: {
              listType: "awxGlobalWatchList",
              listAttributes: [{ fieldName: "accountId", fieldValue: "${accountId}", checkType: EQUAL }]
            }) {
              listType
              listElementId
              status
              listElement
            }
          }`,
          {
            response: z.object({
              data: z
                .object({
                  isFieldInListWithMatchedElements: z
                    .array(
                      z.object({
                        listType: z.string().nullable().optional(),
                        listElementId: z.string().nullable().optional(),
                        status: z.string().nullable().optional(),
                        listElement: z.record(z.unknown()).nullable().optional(),
                      }),
                    )
                    .nullable(),
                })
                .nullable(),
            }),
          },
          {},
          { label: "Check awxGlobalWatchList for account" },
          graphqlHeaders,
        ),
      ),

      // 10. Resolve Legal Entity ID (unless CLE provided in input)
      input.cle
        ? Promise.resolve(input.cle)
        : safeQuery(() =>
            ctx.integrations.risk_common_bff.query(
              `query {
                getLegalEntityIdByAccountId(accountId: "${accountId}")
              }`,
              {
                response: z.object({
                  data: z
                    .object({
                      getLegalEntityIdByAccountId: z.string().nullable(),
                    })
                    .nullable(),
                }),
              },
              {},
              { label: "Resolve legalEntityId from accountId" },
              graphqlHeaders,
            ),
          ),
    ]);

    // ------ Parse Phase 1 results ------
    const kycCases =
      kycCasesResult?.data?.getKycCases?.kycCaseEntries ?? [];
    const tmCases =
      tmCasesResult?.data?.listCases?.cases ?? [];
    const rfiSessions =
      rfiSessionsResult?.data?.getRFISessionList?.values ?? [];
    const rfiList =
      rfiListResult?.data?.getRFIList?.values ?? [];
    const accountInfo = accountDetailsResult?.data?.account ?? null;
    const cardholders =
      cardholdersResult?.data?.getAllCardholders?.items ?? [];
    const issuingAccount =
      issuingAccountResult?.data?.getAccountDetails ?? null;
    const watchlistData =
      watchlistResult?.data?.getAccountLinkageInformationV3 ?? null;
    const watchlistHitCount = watchlistData?.watchListHitsCount ?? 0;
    const watchlistCategories: string[] = watchlistData?.watchListCategories ?? [];
    const linkedAccountsWithHits =
      (watchlistData?.accountLinkageDetails ?? []).filter(
        (a: { watchlistHit?: boolean | null }) => a.watchlistHit === true,
      );

    // Parse global watchlist (awxGlobalWatchList) entries
    const globalWatchlistEntries =
      globalWatchlistResult?.data?.isFieldInListWithMatchedElements ?? [];
    const activeGlobalWatchlistEntries = globalWatchlistEntries.filter(
      (e: { status?: string | null }) => e.status === "ACTIVE",
    );
    const globalWatchlistActive = activeGlobalWatchlistEntries.length > 0;
    const globalWatchlistCategory =
      activeGlobalWatchlistEntries.length > 0
        ? String(activeGlobalWatchlistEntries[0].listElement?.category ?? "Unknown")
        : null;
    const globalWatchlistReason =
      activeGlobalWatchlistEntries.length > 0
        ? String(activeGlobalWatchlistEntries[0].listElement?.reason ?? activeGlobalWatchlistEntries[0].listElement?.description ?? "")
        : null;

    // Resolve legalEntityId: input.cle > API result > KYC case > RFI session > global watchlist
    let legalEntityId: string | null = null;
    if (typeof legalEntityResult === "string") {
      // input.cle was provided
      legalEntityId = legalEntityResult;
    } else if (legalEntityResult && typeof legalEntityResult === "object") {
      legalEntityId =
        (legalEntityResult as { data?: { getLegalEntityIdByAccountId?: string | null } })
          ?.data?.getLegalEntityIdByAccountId ?? null;
    }
    // Fallback: extract from the first KYC case
    if (!legalEntityId && kycCases.length > 0) {
      legalEntityId = kycCases[0].legalEntityId ?? null;
    }
    // Fallback: extract from RFI sessions
    if (!legalEntityId && rfiSessions.length > 0) {
      legalEntityId = rfiSessions[0].clientLegalEntityId ?? null;
    }
    // Fallback: extract from global watchlist entry
    if (!legalEntityId && activeGlobalWatchlistEntries.length > 0) {
      const wlCle = activeGlobalWatchlistEntries[0].listElement?.clientLegalEntityId;
      if (typeof wlCle === "string" && wlCle.length > 0) {
        legalEntityId = wlCle;
      }
    }
    // Fallback: try getLegalEntityBriefByAccountId (works for accounts where
    // getLegalEntityIdByAccountId returns NOT_FOUND)
    if (!legalEntityId) {
      try {
        const briefResult = await ctx.integrations.risk_common_bff.query(
          `query {
            getLegalEntityBriefByAccountId(accountId: "${accountId}") {
              id
              owningEntity
              status
            }
          }`,
          {
            response: z.object({
              data: z
                .object({
                  getLegalEntityBriefByAccountId: z
                    .object({
                      id: z.string().nullable().optional(),
                      owningEntity: z.string().nullable().optional(),
                      status: z.string().nullable().optional(),
                    })
                    .nullable(),
                })
                .nullable(),
            }),
          },
          {},
          { label: "Resolve legalEntityId via CLE brief fallback" },
          graphqlHeaders,
        );
        const briefId = briefResult?.data?.getLegalEntityBriefByAccountId?.id;
        if (typeof briefId === "string" && briefId.length > 0) {
          legalEntityId = briefId;
        }
      } catch {
        // CLE brief fallback failed — continue without legalEntityId
      }
    }

    // ====================================================================
    // PHASE 2: legalEntityId-dependent queries (parallel)
    // Only run if legalEntityId was resolved.
    // ====================================================================

    let universalCases: Array<{
      caseId?: string | null;
      caseType?: string | null;
      caseStatus?: string | null;
      owningEntity?: string | null;
      domains?: string[] | null;
    }> = [];
    let kybCases: Array<{
      caseId?: string | null;
      status?: string | null;
      caseType?: string | null;
    }> = [];
    let kybOngoingCases: Array<{
      caseId?: string | null;
      status?: string | null;
      reviewType?: string | null;
    }> = [];
    let nsCases: Array<{
      uuid?: string | null;
      accountId?: string | null;
      legalEntityId?: string | null;
      status?: string | null;
      categories?: string[] | null;
      screeningType?: string | null;
      archived?: boolean | null;
      rfi?: boolean | null;
      rfiSessionStatus?: string | null;
      owningEntity?: string | null;
      level?: string | null;
    }> = [];
    let realtimeTmCases: Array<{
      caseId?: string | null;
      status?: string | null;
      caseType?: string | null;
      clientLegalEntityId?: string | null;
    }> = [];
    let mrmCases: Array<{
      id?: string | null;
      caseKind?: string | null;
      reviewState?: string | null;
      owningEntity?: string | null;
      rfiSessionStatus?: string | null;
    }> = [];
    let issuingTmCases: Array<{
      caseId?: string | null;
      status?: string | null;
      clientLegalEntityId?: string | null;
    }> = [];

    if (legalEntityId) {
      const [
        universalResult,
        kybResult,
        kybOngoingResult,
        nsResult,
        realtimeResult,
        mrmResult,
        issuingResult,
      ] = await Promise.all([
        // A. Universal Case List via risk-common-bff
        safeQuery(() =>
          ctx.integrations.risk_common_bff.query(
            `query {
              getUniversalCaseList(legalEntityId: "${legalEntityId}") {
                caseId
                caseType
                caseStatus
                owningEntity
                domains
              }
            }`,
            {
              response: z.object({
                data: z
                  .object({
                    getUniversalCaseList: z
                      .array(
                        z.object({
                          caseId: z.string().nullable().optional(),
                          caseType: z.string().nullable().optional(),
                          caseStatus: z.string().nullable().optional(),
                          owningEntity: z.string().nullable().optional(),
                          domains: z.array(z.string()).nullable().optional(),
                        }),
                      )
                      .nullable(),
                  })
                  .nullable(),
              }),
            },
            {},
            { label: "Get universal case list by legalEntityId" },
            graphqlHeaders,
          ),
        ),

        // B. KYB cases via risk-kyb-airboard (getCaseList)
        safeQuery(() =>
          ctx.integrations.risk_kyb_airboard.query(
            `query {
              getCaseList(param: { account: "${accountId}", page: 0, size: 20 }) {
                total
                caseListDtos {
                  caseId
                  status
                  caseType
                }
              }
            }`,
            {
              response: z.object({
                data: z
                  .object({
                    getCaseList: z
                      .object({
                        total: z.number().nullable().optional(),
                        caseListDtos: z
                          .array(
                            z.object({
                              caseId: z.string().nullable().optional(),
                              status: z.string().nullable().optional(),
                              caseType: z.string().nullable().optional(),
                            }),
                          )
                          .nullable()
                          .optional(),
                      })
                      .nullable(),
                  })
                  .nullable(),
              }),
            },
            {},
            { label: "Get KYB cases by account" },
            graphqlHeaders,
          ),
        ),

        // C. KYB ongoing cases via risk-kyb-airboard (getOngoingCaseListV2)
        safeQuery(() =>
          ctx.integrations.risk_kyb_airboard.query(
            `query {
              getOngoingCaseListV2(param: { account: "${accountId}", page: 0, size: 20 }) {
                total
                caseListDtos {
                  caseId
                  status
                  reviewType
                }
              }
            }`,
            {
              response: z.object({
                data: z
                  .object({
                    getOngoingCaseListV2: z
                      .object({
                        total: z.number().nullable().optional(),
                        caseListDtos: z
                          .array(
                            z.object({
                              caseId: z.string().nullable().optional(),
                              status: z.string().nullable().optional(),
                              reviewType: z.string().nullable().optional(),
                            }),
                          )
                          .nullable()
                          .optional(),
                      })
                      .nullable(),
                  })
                  .nullable(),
              }),
            },
            {},
            { label: "Get KYB ongoing cases by account" },
            graphqlHeaders,
          ),
        ),

        // D. NS/Watchlist cases via postmonitoring-graphql (nsListCases)
        safeQuery(() =>
          ctx.integrations.postmonitoring_graphql.query(
            `query {
              nsListCases(listCaseReqInput: {
                accountId: "${accountId}",
                caseType: REVIEW,
                customerSegments: [],
                level: [],
                ownerOrgLevel2s: [],
                owningEntity: [],
                pageIndex: 0,
                pageSize: 20,
                referenceType: [],
                rfiSessionStatuses: [],
                screeningTypes: [],
                status: [],
                transactionCurrencies: []
              }) {
                total
                cases {
                  uuid
                  accountId
                  legalEntityId
                  status
                  categories
                  screeningType
                  archived
                  rfi
                  rfiSessionStatus
                  owningEntity
                  level
                }
              }
            }`,
            {
              response: z.object({
                data: z
                  .object({
                    nsListCases: z
                      .object({
                        total: z.number().nullable().optional(),
                        cases: z
                          .array(
                            z.object({
                              uuid: z.string().nullable().optional(),
                              accountId: z.string().nullable().optional(),
                              legalEntityId: z.string().nullable().optional(),
                              status: z.string().nullable().optional(),
                              categories: z.array(z.string()).nullable().optional(),
                              screeningType: z.string().nullable().optional(),
                              archived: z.boolean().nullable().optional(),
                              rfi: z.boolean().nullable().optional(),
                              rfiSessionStatus: z.string().nullable().optional(),
                              owningEntity: z.string().nullable().optional(),
                              level: z.string().nullable().optional(),
                            }),
                          )
                          .nullable()
                          .optional(),
                      })
                      .nullable(),
                  })
                  .nullable(),
              }),
            },
            {},
            { label: "List NS/watchlist cases" },
            graphqlHeaders,
          ),
        ),

        // E. Realtime TM cases via compliance-graphql
        safeQuery(() => {
          // getRealtimeCaseList requires a time range — scan last 2 years
          const now = new Date();
          const twoYearsAgo = new Date(now);
          twoYearsAgo.setFullYear(twoYearsAgo.getFullYear() - 2);
          const fmtDate = (d: Date) => d.toISOString().split("T")[0];
          return ctx.integrations.compliance_graphql.query(
            `query {
              getRealtimeCaseList(request: {
                clientLegalEntityId: "${legalEntityId}",
                skip: 0,
                limit: 20,
                createTimeStart: "${fmtDate(twoYearsAgo)}",
                createTimeEnd: "${fmtDate(now)}"
              }) {
                hasNext
                total
                data {
                  id
                  status
                  clientLegalEntityId
                }
              }
            }`,
            {
              response: z.object({
                data: z
                  .object({
                    getRealtimeCaseList: z
                      .object({
                        hasNext: z.boolean().nullable().optional(),
                        total: z.number().nullable().optional(),
                        data: z
                          .array(
                            z.object({
                              id: z.string().nullable().optional(),
                              status: z.string().nullable().optional(),
                              clientLegalEntityId: z.string().nullable().optional(),
                            }),
                          )
                          .nullable()
                          .optional(),
                      })
                      .nullable(),
                  })
                  .nullable(),
              }),
            },
            {},
            { label: "Get realtime TM cases by legalEntityId" },
            graphqlHeaders,
          );
        }),

        // F. Post-monitoring MRM/CLE cases via postmonitoring-graphql
        safeQuery(() =>
          ctx.integrations.postmonitoring_graphql.query(
            `query {
              mrmListCases(query: {
                entity: { legalEntityId: "${legalEntityId}" },
                state: OPEN,
                pagination: { pageNumber: 0, pageSize: 10 }
              }) {
                total
                cases {
                  id
                  caseKind
                  reviewStatus { state }
                  entity { owningEntity }
                  rfiSessionStatus
                }
              }
            }`,
            {
              response: z.object({
                data: z
                  .object({
                    mrmListCases: z
                      .object({
                        total: z.number().nullable().optional(),
                        cases: z
                          .array(
                            z.object({
                              id: z.string().nullable().optional(),
                              caseKind: z.string().nullable().optional(),
                              reviewStatus: z
                                .object({
                                  state: z.string().nullable().optional(),
                                })
                                .nullable()
                                .optional(),
                              entity: z
                                .object({
                                  owningEntity: z.string().nullable().optional(),
                                })
                                .nullable()
                                .optional(),
                              rfiSessionStatus: z.string().nullable().optional(),
                            }),
                          )
                          .nullable()
                          .optional(),
                      })
                      .nullable(),
                  })
                  .nullable(),
              }),
            },
            {},
            { label: "List MRM/CLE post-monitoring cases" },
            graphqlHeaders,
          ),
        ),

        // G. (Removed) Issuing-specific realtime TM query — TransactionType
        // enum has no ISSUING/CARD value, so the filter was invalid and the
        // query always silently failed.  Any issuing-related TM cases that
        // exist in compliance-graphql will be captured by the general
        // realtime TM query in step E.
        Promise.resolve(null),
      ]);

      // Parse Phase 2 results
      universalCases = universalResult?.data?.getUniversalCaseList ?? [];
      kybCases = kybResult?.data?.getCaseList?.caseListDtos ?? [];
      kybOngoingCases = kybOngoingResult?.data?.getOngoingCaseListV2?.caseListDtos ?? [];
      nsCases = nsResult?.data?.nsListCases?.cases ?? [];
      realtimeTmCases = (realtimeResult?.data?.getRealtimeCaseList?.data ?? []).map(
        (c: { id?: string | null; status?: string | null; clientLegalEntityId?: string | null }) => ({
          caseId: c.id ?? null,
          status: c.status ?? null,
          caseType: null as string | null,
          clientLegalEntityId: c.clientLegalEntityId ?? null,
        }),
      );
      mrmCases = (mrmResult?.data?.mrmListCases?.cases ?? []).map(
        (c: {
          id?: string | null;
          caseKind?: string | null;
          reviewStatus?: { state?: string | null } | null;
          entity?: { owningEntity?: string | null } | null;
          rfiSessionStatus?: string | null;
        }) => ({
          id: c.id ?? null,
          caseKind: c.caseKind ?? null,
          reviewState: c.reviewStatus?.state ?? null,
          owningEntity: c.entity?.owningEntity ?? null,
          rfiSessionStatus: c.rfiSessionStatus ?? null,
        }),
      );
      // issuingResult is null — issuing-specific query removed (invalid enum).
      // issuingTmCases stays empty; any issuing cases are in realtimeTmCases.
    }

    // ====================================================================
    // DETERMINE DATA PRESENCE
    // ====================================================================

    const anyDataFound =
      kycCases.length > 0 ||
      tmCases.length > 0 ||
      rfiSessions.length > 0 ||
      rfiList.length > 0 ||
      accountInfo !== null ||
      cardholders.length > 0 ||
      issuingAccount !== null ||
      watchlistData !== null ||
      universalCases.length > 0 ||
      kybCases.length > 0 ||
      kybOngoingCases.length > 0 ||
      nsCases.length > 0 ||
      realtimeTmCases.length > 0 ||
      mrmCases.length > 0 ||
      issuingTmCases.length > 0 ||
      globalWatchlistActive;

    if (!anyDataFound) {
      return {
        recommendation: null,
        error: `Account ID "${accountId}" was not found in any connected source for the current data tag. The frontend should scan other regions before showing this error.`,
      };
    }

    // ====================================================================
    // CLASSIFY CASES ACROSS ALL SOURCES
    // ====================================================================

    // --- Active KYC cases (from kyc-service) ---
    const activeKycCases = kycCases.filter((c) => isActive(c.caseStatus));

    // --- Active TM cases from postmonitoring (non-PA) ---
    // PA signals from TM domains
    const PA_DOMAIN_KEYWORDS = ["PA", "RISK_OPS", "CREDIT"];
    const paCases = tmCases.filter(
      (c) =>
        c.domains?.some((d) =>
          PA_DOMAIN_KEYWORDS.some((kw) => d.toUpperCase().includes(kw)),
        ),
    );
    const activeTmCases = tmCases.filter(
      (c) => isActive(c.status) && !paCases.includes(c),
    );

    // --- Active KYB cases ---
    const activeKybCases = kybCases.filter((c) => isActive(c.status));
    const activeKybOngoing = kybOngoingCases.filter((c) => isActive(c.status));
    const allActiveKyb = [...activeKybCases, ...activeKybOngoing];

    // --- Active NS/Watchlist cases (not archived) ---
    const activeNsCases = nsCases.filter(
      (c) => c.archived !== true && isActive(c.status),
    );

    // NS categories classified for routing
    const PA_NS_CATEGORIES = new Set([
      "SANCTIONS",
      "PEP",
      "ADVERSE_MEDIA",
      "ADVERSE MEDIA",
      "CREDIT_CONCERN",
      "CREDIT CONCERN",
      "PA_ADDED",
      "PA ADDED",
    ]);
    const TM_NS_CATEGORIES = new Set([
      "ADVERSE_MEDIA",
      "ADVERSE MEDIA",
    ]);

    const nsWithPaSignal = activeNsCases.filter((c) =>
      (c.categories ?? []).some((cat) => PA_NS_CATEGORIES.has(cat.toUpperCase())),
    );
    const nsWithTmSignal = activeNsCases.filter(
      (c) =>
        (c.categories ?? []).some((cat) => TM_NS_CATEGORIES.has(cat.toUpperCase())) &&
        !nsWithPaSignal.includes(c),
    );

    // --- Active realtime TM cases ---
    const activeRealtimeTm = realtimeTmCases.filter((c) => isActive(c.status));

    // --- Active MRM/CLE post-monitoring cases ---
    const activeMrmCases = mrmCases.filter(
      (c) => c.reviewState?.toUpperCase() !== "CLOSED" && c.reviewState?.toUpperCase() !== "RESOLVED",
    );

    // --- Active issuing-specific TM cases ---
    const activeIssuingTm = issuingTmCases.filter((c) => isActive(c.status));

    // --- Universal cases classified by type ---
    const activeUniversalCases = universalCases.filter((c) => isActive(c.caseStatus));
    const universalKycCases = activeUniversalCases.filter(
      (c) => c.caseType?.toUpperCase().includes("KYC"),
    );
    const universalKybCases = activeUniversalCases.filter(
      (c) => c.caseType?.toUpperCase().includes("KYB"),
    );
    const universalTmCases = activeUniversalCases.filter(
      (c) =>
        c.caseType?.toUpperCase().includes("TM") ||
        c.caseType?.toUpperCase().includes("TRANSACTION"),
    );
    const universalPaCases = activeUniversalCases.filter(
      (c) =>
        c.caseType?.toUpperCase().includes("PA") ||
        c.domains?.some((d) =>
          PA_DOMAIN_KEYWORDS.some((kw) => d.toUpperCase().includes(kw)),
        ),
    );

    // --- Watchlist PA signal (from account linkage) ---
    const PA_WATCHLIST_CATEGORIES = [
      "SANCTIONS",
      "PEP",
      "ADVERSE_MEDIA",
      "ADVERSE MEDIA",
      "CREDIT_CONCERN",
      "CREDIT CONCERN",
      "PA_ADDED",
      "PA ADDED",
      "RISK_OPS",
    ];
    const hasWatchlistPaSignal =
      watchlistHitCount > 0 &&
      watchlistCategories.some((cat) =>
        PA_WATCHLIST_CATEGORIES.some((pa) =>
          cat.toUpperCase().includes(pa),
        ),
      );

    // --- Pending cardholders ---
    const pendingCardholders = cardholders.filter(
      (ch) => ch.status && ch.status.toUpperCase().includes("PENDING"),
    );

    // --- Aggregate "has any cases" check ---
    const hasAnyCases =
      kycCases.length > 0 ||
      tmCases.length > 0 ||
      rfiSessions.length > 0 ||
      rfiList.length > 0 ||
      cardholders.length > 0 ||
      watchlistHitCount > 0 ||
      universalCases.length > 0 ||
      allActiveKyb.length > 0 ||
      activeNsCases.length > 0 ||
      activeRealtimeTm.length > 0 ||
      activeMrmCases.length > 0 ||
      activeIssuingTm.length > 0 ||
      globalWatchlistActive;

    // ====================================================================
    // OWNING ENTITY + REGION
    // ====================================================================

    const owningEntity =
      accountInfo?.owningEntity ??
      issuingAccount?.awxOwningEntity ??
      (kycCases.length > 0 ? kycCases[0].owningEntity : null) ??
      (activeNsCases.length > 0 ? activeNsCases[0].owningEntity : null) ??
      (activeMrmCases.length > 0 ? activeMrmCases[0].owningEntity : null) ??
      null;
    const region = accountInfo?.dataCenter ?? null;

    // ====================================================================
    // RFI STATUS
    // ====================================================================

    const allRfiItems = [
      ...rfiSessions.map((s) => ({ id: s.id, status: s.status, type: s.type })),
      ...rfiList.map((r) => ({ id: r.id, status: r.status, type: r.type })),
    ];
    const kycRfiStatuses = kycCases.map((c) => c.rfiStatus).filter(Boolean);
    // Also include NS case RFI status
    const nsRfiStatuses = activeNsCases
      .filter((c) => c.rfi === true)
      .map((c) => c.rfiSessionStatus)
      .filter(Boolean);
    // Include MRM case RFI session status
    const mrmRfiStatuses = activeMrmCases
      .map((c) => c.rfiSessionStatus)
      .filter(Boolean);

    let rfiStatus: RfiStatus = "None";
    const hasPendingRfi = allRfiItems.some(
      (r) => r.status === "PENDING" || r.status === "DRAFT",
    );
    const hasAnsweredRfi = allRfiItems.some((r) => r.status === "ANSWERED");
    const hasClosedRfi = allRfiItems.some((r) => r.status === "CLOSED");
    const hasKycOpenRfi = kycRfiStatuses.some(
      (s) =>
        s?.toUpperCase().includes("OPEN") ||
        s?.toUpperCase().includes("PENDING") ||
        s?.toUpperCase().includes("SENT"),
    );
    const hasKycClosedRfi = kycRfiStatuses.some(
      (s) =>
        s?.toUpperCase().includes("CLOSED") ||
        s?.toUpperCase().includes("ANSWERED") ||
        s?.toUpperCase().includes("COMPLETED"),
    );
    const hasNsOpenRfi = nsRfiStatuses.some(
      (s) =>
        s?.toUpperCase().includes("OPEN") ||
        s?.toUpperCase().includes("PENDING"),
    );
    const hasMrmOpenRfi = mrmRfiStatuses.some(
      (s) =>
        s?.toUpperCase().includes("OPEN") ||
        s?.toUpperCase().includes("PENDING") ||
        s?.toUpperCase().includes("SENT"),
    );

    if (hasPendingRfi || hasKycOpenRfi || hasNsOpenRfi || hasMrmOpenRfi) {
      rfiStatus = "Open";
    } else if (hasAnsweredRfi || hasClosedRfi || hasKycClosedRfi) {
      rfiStatus = "Closed";
    }

    // ====================================================================
    // EXTRACT USER IDENTIFIERS
    // ====================================================================

    const userId =
      input.userId ??
      (kycCases.length > 0 ? kycCases[0].openId : null) ??
      null;
    const email =
      input.email ??
      (kycCases.length > 0 ? kycCases[0].email : null) ??
      (cardholders.length > 0 ? cardholders[0].email : null) ??
      null;
    const cardholderId =
      input.cardholderId ??
      (cardholders.length > 0 ? cardholders[0].id : null) ??
      null;

    // ====================================================================
    // ROUTING DECISION (Priority: Global Watchlist > PA Risk Ops > KYC > KYB > TM > CS)
    // ====================================================================

    // --- Watchlist category → CS playbook mapping ---
    // IMPORTANT: Never use the word "watchlist" in customer-facing messages.
    type WatchlistPlaybook = {
      routing: RoutingCategory;
      escalationPoint: string;
      customerImpact: string;
      suggestedAction: string;
      customerMsg: string;
    };

    function getWatchlistPlaybook(
      category: string | null,
      reason: string | null,
    ): WatchlistPlaybook {
      const cat = (category ?? "").toLowerCase().trim();
      const reasonStr = reason ?? "";

      if (cat.includes("credit") || cat.includes("pa risk") || cat.includes("lending")) {
        return {
          routing: "PA Risk Ops",
          escalationPoint: `Global watchlist: ${category}`,
          customerImpact: `Payouts may be reviewed or blocked (${category}): ${reasonStr}`,
          suggestedAction:
            "1. Check KYB status\n" +
            "2. Locate PA Termination Notice: Airboard → Utility → Email History → Search by Recipient (Primary Contact)\n" +
            "3. If notice found → macro: Payments::PA Suspension (Suspension Notice Sent)\n" +
            "4. If no notice → confirm added by PA Risk Ops (check 'Watchlist Last Updated by')\n" +
            "   • Managed account → escalate to BD\n" +
            "   • Self-serve → Raise Jira: https://airwallex.atlassian.net/servicedesk/customer/portal/111/group/297\n" +
            "   • Use 'Inquiries on PA clients status' if no termination notice found\n" +
            "   • For appeals → 'Appeal/Follow up on KYB Case Rejection'",
          customerMsg:
            "We're reviewing your account. Our team will be in touch with any updates or next steps.",
        };
      }

      if (cat.includes("fraud") || cat.includes("frozen")) {
        return {
          routing: "PA Risk Ops",
          escalationPoint: `Global watchlist: ${category}`,
          customerImpact: `All account activity blocked (${category}): ${reasonStr}`,
          suggestedAction:
            "1. Locate Suspension Notice: Airboard → Utility → Email History → Search by Recipient (Primary Contact)\n" +
            "2. If notice found → macro: Account suspension - Email Sent\n" +
            "3. If no notice → macro: Account suspension response, then notify TM via CS Ops Escalations (Non FinOps)\n" +
            "   (No further action needed — relevant team will contact customer)",
          customerMsg:
            "Your account is currently under review. Our team will reach out to you directly with further information.",
        };
      }

      if (cat.includes("rfi") || cat.includes("non-responsive") || cat.includes("nonresponsive")) {
        return {
          routing: "KYC",
          escalationPoint: `Global watchlist: ${category}`,
          customerImpact: `Payouts blocked; deposits and issuing may continue (${category}): ${reasonStr}`,
          suggestedAction:
            "1. Locate the RFI in Airboard:\n" +
            "   • TM: Airboard > Risk > Investigation Inquiry\n" +
            "   • NS: Airboard > Risk > Namescreening\n" +
            "   • KYC: Airboard > Legal Entity > KYC Cases\n" +
            "2. Check Utilities > Email History for when the RFI was sent\n" +
            "3. If customer has NOT responded → macro: Watchlist:: Client Is Non-Responsive (RFI Sent)\n" +
            "4. If customer HAS responded → macro: Watchlist:: Client Is Non-Responsive (RFI responded to, escalation macro)\n" +
            "   Escalate to team of the 'Last Updated by' field",
          customerMsg:
            "We sent a verification request that requires your response. Please check your email for details and respond at your earliest convenience so we can resolve this.",
        };
      }

      if (cat.includes("negative balance")) {
        return {
          routing: "PA Risk Ops",
          escalationPoint: `Global watchlist: ${category}`,
          customerImpact: `Payouts blocked due to negative balance: ${reasonStr}`,
          suggestedAction:
            "1. Check whether the negative balance is still outstanding\n" +
            "2. If still negative → macro: Customer on WL due to Negative Balance\n" +
            "3. If cleared → watchlist auto-removes next day. To expedite, raise Jira to PA Team (HKSEA → local CS)",
          customerMsg:
            "There is an outstanding balance on your account that needs to be resolved. Once cleared, normal service will resume.",
        };
      }

      if (cat.includes("sanctions")) {
        return {
          routing: "PA Risk Ops",
          escalationPoint: `Global watchlist: ${category}`,
          customerImpact: `Payouts may be reviewed or blocked (${category}): ${reasonStr}`,
          suggestedAction:
            "Escalate to Name Screening team.\n" +
            "Macro: Watchlist:: Account in Sanctions Concern Watchlist",
          customerMsg:
            "Your account is currently under review by our compliance team. We will follow up with you shortly.",
        };
      }

      if (cat.includes("monitoring")) {
        return {
          routing: "TM",
          escalationPoint: `Global watchlist: ${category}`,
          customerImpact: `Transactions under review by TM (customer is NOT informed of restrictions): ${reasonStr}`,
          suggestedAction:
            "DO NOT inform the customer of any restrictions or reviews.\n" +
            "No further action typically needed — customer can transact as usual.\n" +
            "If inquiry is about payout/deposit, follow standard Payout/Deposit Investigation Steps.",
          customerMsg:
            "Everything looks fine on our end. Please proceed with your transactions as usual. If you experience any issues, let us know.",
        };
      }

      if (cat.includes("offboarding") || cat.includes("finalize")) {
        return {
          routing: "CS",
          escalationPoint: `Global watchlist: ${category}`,
          customerImpact: `Customer is being offboarded; balance payout may be reviewed: ${reasonStr}`,
          suggestedAction:
            "1. Locate Notice of Termination: Airboard Utilities > Email History + search Zendesk by business name\n" +
            "2. If customer received notice and pushes back → macro: AWX Driven Offboarding - Pushback\n" +
            "3. If continues pushback or no notice sent → escalate to local CS",
          customerMsg:
            "Our records show your account closure is in progress. If you have questions about the process, we're here to help.",
        };
      }

      if (cat.includes("transaction freeze")) {
        return {
          routing: "CS",
          escalationPoint: `Global watchlist: ${category}`,
          customerImpact: `Account frozen due to external-party request: ${reasonStr}`,
          suggestedAction: "Raise to Local CS.",
          customerMsg:
            "Your account is currently under a temporary hold. Our team is looking into this and will update you as soon as possible.",
        };
      }

      if (cat.includes("high risk") || cat.includes("new onboarded")) {
        return {
          routing: "CS",
          escalationPoint: `Global watchlist: ${category}`,
          customerImpact: `Account usage blocked (newly onboarded high risk): ${reasonStr}`,
          suggestedAction:
            "1. Raise to Local CS\n" +
            "2. Local CS to raise with Risk Support on Slack #risk-support",
          customerMsg:
            "Your account is being reviewed as part of our onboarding process. We'll update you once the review is complete.",
        };
      }

      // Fallback for unrecognised categories
      return {
        routing: "PA Risk Ops",
        escalationPoint: `Global watchlist: ${category ?? "Unknown"}`,
        customerImpact: `Account on global watchlist (${category ?? "Unknown"}): ${reasonStr}`,
        suggestedAction:
          "Raise Jira ticket at https://airwallex.atlassian.net/servicedesk/customer/portal/111/group/297",
        customerMsg:
          "Your account is currently under review. Our team will be in touch with any updates.",
      };
    }
    // --- End playbook mapping ---

    const missingInputs: string[] = [];
    const conflicts: string[] = [];

    let routingCategory: RoutingCategory;
    let escalationPoint: string;
    let currentStatus: string;
    let whatIsOutstanding: string;
    let suggestedInternalAction: string;
    let customerMessageOverride: string | null = null;

    // ----- Global Watchlist (highest priority — category-specific playbook) -----
    if (
      globalWatchlistActive &&
      paCases.length === 0 &&
      !hasWatchlistPaSignal &&
      nsWithPaSignal.length === 0 &&
      universalPaCases.length === 0
    ) {
      // Pure global watchlist trigger — use category-specific playbook
      const playbook = getWatchlistPlaybook(globalWatchlistCategory, globalWatchlistReason);
      routingCategory = playbook.routing;
      escalationPoint = playbook.escalationPoint;
      currentStatus = `Global watchlist: ${globalWatchlistCategory ?? "Unknown"} — ${globalWatchlistReason ?? "no reason given"}`;
      whatIsOutstanding = playbook.customerImpact;
      suggestedInternalAction = playbook.suggestedAction;
      // Override customer message after the routing block
      customerMessageOverride = playbook.customerMsg;
    }

    // ----- PA Risk Ops (other PA signals, may combine with watchlist) -----
    else if (
      paCases.length > 0 ||
      hasWatchlistPaSignal ||
      nsWithPaSignal.length > 0 ||
      universalPaCases.length > 0
    ) {
      routingCategory = "PA Risk Ops";

      // Build a combined status message
      const paSignals: string[] = [];
      if (nsWithPaSignal.length > 0) {
        const nsCats = [
          ...new Set(nsWithPaSignal.flatMap((c) => c.categories ?? [])),
        ];
        paSignals.push(
          `${nsWithPaSignal.length} NS case(s): ${nsCats.join(", ")}`,
        );
      }
      if (hasWatchlistPaSignal) {
        paSignals.push(
          `${watchlistHitCount} watchlist hit(s): ${watchlistCategories.join(", ")}`,
        );
      }
      if (paCases.length > 0) {
        paSignals.push(
          `${paCases.length} PA TM case(s) — status: ${paCases[0].status ?? "Unknown"}`,
        );
      }
      if (universalPaCases.length > 0) {
        paSignals.push(
          `${universalPaCases.length} universal PA case(s)`,
        );
      }
      if (globalWatchlistActive) {
        paSignals.push(
          `Global watchlist: ${globalWatchlistCategory ?? "Unknown"} — ${globalWatchlistReason ?? "no reason given"}`,
        );
      }

      escalationPoint =
        nsWithPaSignal.length > 0
          ? `Name screening match: ${[...new Set(nsWithPaSignal.flatMap((c) => c.categories ?? []))].join(", ")}`
          : hasWatchlistPaSignal
            ? `Watchlist hit: ${watchlistCategories.join(", ")}`
            : globalWatchlistActive
              ? `Global watchlist: ${globalWatchlistCategory ?? "Unknown"}`
              : "PA Risk Ops case or restriction";

      currentStatus = paSignals.join(" | ");

      whatIsOutstanding =
        rfiStatus === "Open"
          ? "Customer verification request outstanding; PA case active"
          : nsWithPaSignal.length > 0
            ? `Name screening match requires PA Risk Ops review (${[...new Set(nsWithPaSignal.flatMap((c) => c.categories ?? []))].join(", ")})`
            : hasWatchlistPaSignal
              ? `Watchlist match requires PA Risk Ops review (${watchlistCategories.join(", ")})`
              : globalWatchlistActive
                ? `Account on global watchlist (${globalWatchlistCategory ?? "Unknown"}): ${globalWatchlistReason ?? "requires review"}`
                : "PA Risk Ops review in progress";

      suggestedInternalAction = globalWatchlistActive
        ? "Raise Jira ticket at https://airwallex.atlassian.net/servicedesk/customer/portal/111/group/297"
        : "Escalate to PA Risk Ops queue. Do not route to KYC.";
    }

    // ----- MRM / Post-Monitoring CLE cases → PA Risk Ops -----
    else if (activeMrmCases.length > 0) {
      routingCategory = "PA Risk Ops";
      escalationPoint = `Post-monitoring review active (${activeMrmCases.length} case(s))`;
      currentStatus = `${activeMrmCases.length} active post-monitoring case(s) — review state: ${activeMrmCases[0].reviewState ?? "Open"}`;
      whatIsOutstanding =
        "Active post-monitoring review in progress. Account under enhanced scrutiny.";
      suggestedInternalAction =
        `Post-monitoring case detected. Escalate to PA Risk Ops${owningEntity ? ` (${owningEntity})` : ""}. Do not route to KYC or TM.`;
    }

    // ----- KYC -----
    else if (
      activeKycCases.length > 0 ||
      pendingCardholders.length > 0 ||
      universalKycCases.length > 0
    ) {
      routingCategory = "KYC";
      const kycCase = activeKycCases[0] ?? null;
      const reviewType = kycCase?.reviewType ?? null;

      if (pendingCardholders.length > 0 && activeKycCases.length === 0) {
        escalationPoint = "Pending cardholder verification";
        currentStatus = `Cardholder status: ${pendingCardholders[0].status}`;
      } else if (universalKycCases.length > 0 && activeKycCases.length === 0) {
        escalationPoint = "Active KYC case (universal)";
        currentStatus = `Universal case status: ${universalKycCases[0].caseStatus ?? "Unknown"}`;
      } else {
        escalationPoint = reviewType ? `KYC ${reviewType}` : "Active KYC case";
        currentStatus = `KYC case status: ${kycCase?.caseStatus ?? "Unknown"}`;
      }

      whatIsOutstanding =
        rfiStatus === "Open"
          ? "Customer verification request outstanding; KYC case pending"
          : rfiStatus === "Closed"
            ? "Customer response received; KYC team review pending"
            : "KYC case requires team action";

      suggestedInternalAction =
        rfiStatus === "Open"
          ? "Advise customer to complete RFI before escalating to KYC."
          : `Escalate to KYC team${owningEntity ? ` (${owningEntity})` : ""}.`;
    }

    // ----- KYB (new) -----
    else if (allActiveKyb.length > 0 || universalKybCases.length > 0) {
      routingCategory = "KYB";
      const kybCase = allActiveKyb[0] ?? null;

      if (kybCase) {
        escalationPoint = kybCase.status
          ? `KYB case — ${(kybCase as { reviewType?: string }).reviewType ?? (kybCase as { caseType?: string }).caseType ?? "review"}`
          : "Active KYB case";
        currentStatus = `KYB case status: ${kybCase.status ?? "Unknown"}`;
      } else {
        escalationPoint = "Active KYB case (universal)";
        currentStatus = `Universal KYB case status: ${universalKybCases[0].caseStatus ?? "Unknown"}`;
      }

      whatIsOutstanding =
        rfiStatus === "Open"
          ? "Customer verification request outstanding; KYB review pending"
          : "KYB review in progress";

      suggestedInternalAction = `Escalate to KYB team${owningEntity ? ` (${owningEntity})` : ""}.`;
    }

    // ----- TM -----
    else if (
      activeTmCases.length > 0 ||
      activeRealtimeTm.length > 0 ||
      activeIssuingTm.length > 0 ||
      universalTmCases.length > 0 ||
      nsWithTmSignal.length > 0 ||
      input.transactionId ||
      input.depositId ||
      input.payoutId
    ) {
      routingCategory = "TM";
      const tmCase = activeTmCases[0] ?? null;

      // Build combined status
      const tmSignals: string[] = [];
      if (activeTmCases.length > 0) {
        tmSignals.push(`${activeTmCases.length} postmonitoring case(s)`);
      }
      if (activeRealtimeTm.length > 0) {
        tmSignals.push(`${activeRealtimeTm.length} realtime case(s)`);
      }
      if (activeIssuingTm.length > 0) {
        tmSignals.push(`${activeIssuingTm.length} issuing/card risk case(s)`);
      }
      if (universalTmCases.length > 0) {
        tmSignals.push(`${universalTmCases.length} universal TM case(s)`);
      }
      if (nsWithTmSignal.length > 0) {
        tmSignals.push(
          `${nsWithTmSignal.length} NS adverse media case(s)`,
        );
      }

      if (input.depositId) {
        escalationPoint = "Deposit in review";
      } else if (input.payoutId) {
        escalationPoint = "Payout in review";
      } else if (input.transactionId) {
        escalationPoint = "Transaction in review";
      } else if (activeIssuingTm.length > 0) {
        escalationPoint = "Issuing/card risk case active";
      } else if (activeRealtimeTm.length > 0) {
        escalationPoint = "Realtime TM case active";
      } else {
        escalationPoint = "TM case active";
      }

      currentStatus =
        tmSignals.length > 0
          ? tmSignals.join(" | ")
          : tmCase
            ? `TM case status: ${tmCase.status ?? "Unknown"}`
            : "Under transaction review";

      whatIsOutstanding =
        rfiStatus === "Open"
          ? "Customer verification request outstanding; transaction review pending"
          : "Transaction review in progress by TM team";

      suggestedInternalAction =
        rfiStatus === "Open"
          ? "Advise customer to complete RFI before escalating to TM."
          : `Escalate to TM${owningEntity ? ` (${owningEntity})` : ""}. Do not route to KYC.`;
    }

    // ----- CS (fallback: account found, no active cases) -----
    else if (!hasAnyCases) {
      routingCategory = "CS";
      escalationPoint = "Account found — no active cases";
      currentStatus = accountInfo?.status
        ? `Account status: ${accountInfo.status}`
        : "Active (no open cases)";
      whatIsOutstanding =
        "No open KYC, KYB, TM, or PA Risk Ops cases found for this account.";
      suggestedInternalAction =
        "No internal escalation needed. If the customer reports a specific issue, re-analyse with ticket context.";
    }

    // ----- CS (fallback: cases exist but none active/matching) -----
    else {
      routingCategory = "CS";
      escalationPoint = "No matching active case found";
      currentStatus = accountInfo?.status
        ? `Account status: ${accountInfo.status}`
        : "No active case identified";
      whatIsOutstanding =
        "Insufficient information to route to a specific internal team";
      suggestedInternalAction =
        "Gather more context from the customer. If a specific issue is identified, re-analyse.";
      if (!input.ticketContext) {
        missingInputs.push(
          "Zendesk ticket context or customer-reported issue description",
        );
      }
    }

    // ====================================================================
    // CUSTOMER MESSAGE
    // ====================================================================

    let customerMessage = RFI_MESSAGES[rfiStatus];
    if (customerMessageOverride) {
      customerMessage = customerMessageOverride;
    } else if (routingCategory === "TM" && rfiStatus === "None") {
      customerMessage =
        "No open verification request is showing. The relevant team will check the current transaction status.";
    } else if (routingCategory === "CS") {
      customerMessage =
        "We are looking into this for you. Could you share any additional details about the issue so we can assist further?";
    }

    // ====================================================================
    // CONFLICT DETECTION
    // ====================================================================

    if (
      input.ticketContext &&
      input.ticketContext.toLowerCase().includes("kyc") &&
      activeKycCases.length === 0 &&
      universalKycCases.length === 0
    ) {
      conflicts.push(
        "Ticket mentions KYC but no active KYC case found for this account",
      );
    }

    if (
      input.ticketContext &&
      (input.ticketContext.toLowerCase().includes("transaction") ||
        input.ticketContext.toLowerCase().includes("deposit") ||
        input.ticketContext.toLowerCase().includes("payout")) &&
      activeTmCases.length === 0 &&
      activeRealtimeTm.length === 0 &&
      routingCategory !== "TM"
    ) {
      conflicts.push(
        "Ticket mentions transaction/deposit/payout but no active TM case found",
      );
    }

    if (
      input.ticketContext &&
      input.ticketContext.toLowerCase().includes("watchlist") &&
      activeNsCases.length === 0 &&
      watchlistHitCount === 0 &&
      !globalWatchlistActive
    ) {
      conflicts.push(
        "Ticket mentions watchlist but no active NS cases or watchlist hits found",
      );
    }

    // ====================================================================
    // BUILD SUPPORTING INFO SUMMARIES
    // ====================================================================

    const universalCaseSummary =
      activeUniversalCases.length > 0
        ? `${activeUniversalCases.length} active: ${[...new Set(activeUniversalCases.map((c) => c.caseType).filter(Boolean))].join(", ")}`
        : null;

    const kybCaseStatus =
      allActiveKyb.length > 0
        ? `${allActiveKyb.length} active KYB case(s) — ${allActiveKyb[0].status ?? "Unknown"}`
        : null;

    const nsCasesSummary =
      activeNsCases.length > 0
        ? `${activeNsCases.length} active NS case(s): ${[...new Set(activeNsCases.flatMap((c) => c.categories ?? []))].join(", ")}${activeNsCases.some((c) => c.rfi) ? " | RFI active" : ""}`
        : null;

    const realtimeTmSummary =
      activeRealtimeTm.length > 0
        ? `${activeRealtimeTm.length} active realtime TM case(s)`
        : null;

    const mrmCaseSummary =
      activeMrmCases.length > 0
        ? `${activeMrmCases.length} active post-monitoring case(s) — state: ${activeMrmCases[0].reviewState ?? "Open"}${activeMrmCases.some((c) => c.rfiSessionStatus) ? " | RFI: " + activeMrmCases.filter((c) => c.rfiSessionStatus).map((c) => c.rfiSessionStatus).join(", ") : ""}`
        : null;

    const issuingTmSummary =
      activeIssuingTm.length > 0
        ? `${activeIssuingTm.length} active issuing/card risk case(s)`
        : null;

    // ====================================================================
    // BUILD RECOMMENDATION
    // ====================================================================

    const recommendation = {
      escalationPoint,
      recommendedTeam: `${routingCategory}${owningEntity ? ` / ${owningEntity}` : ""}`,
      currentStatus,
      rfiStatus,
      whatIsOutstanding,
      customerMessage,
      suggestedInternalAction,
      supportingInfo: {
        accountId,
        userId: userId ?? null,
        email: email ?? null,
        cardholderId: cardholderId ?? null,
        cardId: input.cardId ?? null,
        transactionId: input.transactionId ?? null,
        depositId: input.depositId ?? null,
        payoutId: input.payoutId ?? null,
        kycStage:
          activeKycCases.length > 0
            ? activeKycCases[0].reviewType ?? null
            : null,
        watchlistSource:
          watchlistHitCount > 0
            ? `${watchlistHitCount} hit(s): ${watchlistCategories.join(", ")}${linkedAccountsWithHits.length > 0 ? ` | ${linkedAccountsWithHits.length} linked account(s) with hits` : ""}`
            : paCases.length > 0
              ? paCases[0].domains?.join(", ") ?? null
              : null,
        owningEntity: owningEntity ?? null,
        region: region ?? null,
        // New fields
        legalEntityId: legalEntityId ?? null,
        universalCaseSummary,
        kybCaseStatus,
        nsCasesSummary,
        realtimeTmSummary,
        mrmCaseSummary,
        issuingTmSummary,
        // Global watchlist fields
        globalWatchlistStatus: globalWatchlistActive ? "ACTIVE" : null,
        globalWatchlistCategory: globalWatchlistCategory ?? null,
        globalWatchlistReason: globalWatchlistReason ?? null,
      },
      missingInputs,
      conflicts,
    };

    return { recommendation, error: null };
  },
});
