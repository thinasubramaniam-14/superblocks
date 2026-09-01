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

// --- Routing categories ---
type RoutingCategory = "KYC" | "TM" | "PA Risk Ops" | "CS";
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

export default api({
  name: "AnalyseEscalation",
  description:
    "Aggregates account, KYC, TM, card, and watchlist data to route CS escalations",

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

    // Derive auth headers per org knowledge:
    // GraphQL integrations: raw token (no Bearer prefix)
    // REST integrations (airboardng-api, iss-airboardng-api): Bearer prefix
    // If airboardToken is absent (staging fallback), omit headers to fall back to integration defaults.
    const graphqlHeaders = input.airboardToken
      ? { Authorization: input.airboardToken }
      : undefined;
    const bearerHeaders = input.airboardToken
      ? { Authorization: `Bearer ${input.airboardToken}` }
      : undefined;

    if (!accountId || accountId.trim() === "") {
      return { recommendation: null, error: "Account ID is required." };
    }

    // ------ Step 1: Query all services in parallel (Account ID-based) ------
    // Do NOT gate on CLE/account-settings lookup — many services accept Account ID directly.

    const [
      kycCasesResult,
      tmCasesResult,
      rfiSessionsResult,
      rfiListResult,
      accountDetailsResult,
      cardholdersResult,
      issuingAccountResult,
      watchlistResult,
    ] = await Promise.all([
      // KYC cases via airboard-ng-kyc-service (direct Account ID)
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

      // TM cases via postmonitoring-graphql (direct Account ID via account.uuid)
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

      // RFI sessions via compliance-graphql (direct Account ID)
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

      // RFI list via compliance-graphql (direct Account ID)
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

      // Account info via account-settings-airboard
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

      // Cardholders via iss-airboardng-api (direct Account ID)
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

      // Issuing account details via iss-airboardng-api
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

      // Watchlist data via risk-common-bff (Account Linkage V3)
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
    ]);

    // ------ Step 2: Parse results ------
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

    // Determine if ANY service returned data — soft validation
    const anyDataFound =
      kycCases.length > 0 ||
      tmCases.length > 0 ||
      rfiSessions.length > 0 ||
      rfiList.length > 0 ||
      accountInfo !== null ||
      cardholders.length > 0 ||
      issuingAccount !== null ||
      watchlistData !== null;

    if (!anyDataFound) {
      return {
        recommendation: null,
        error: `Account ID "${accountId}" was not found in any connected source for the current data tag. The frontend should scan other regions before showing this error.`,
      };
    }

    // Check if account exists but has no active cases at all
    const hasAnyCases =
      kycCases.length > 0 ||
      tmCases.length > 0 ||
      rfiSessions.length > 0 ||
      rfiList.length > 0 ||
      cardholders.length > 0 ||
      watchlistHitCount > 0;

    // ------ Step 3: Determine owning entity and region ------
    const owningEntity =
      accountInfo?.owningEntity ??
      issuingAccount?.awxOwningEntity ??
      (kycCases.length > 0 ? kycCases[0].owningEntity : null) ??
      null;
    const region = accountInfo?.dataCenter ?? null;

    // ------ Step 4: Determine RFI status ------
    // Combine RFI sessions and RFI list for comprehensive status
    const allRfiItems = [
      ...rfiSessions.map((s) => ({
        id: s.id,
        status: s.status,
        type: s.type,
      })),
      ...rfiList.map((r) => ({
        id: r.id,
        status: r.status,
        type: r.type,
      })),
    ];

    // Also check KYC case rfiStatus
    const kycRfiStatuses = kycCases
      .map((c) => c.rfiStatus)
      .filter(Boolean);

    let rfiStatus: RfiStatus = "None";

    // Check if any RFI is open/pending
    const hasPendingRfi = allRfiItems.some(
      (r) =>
        r.status === "PENDING" ||
        r.status === "DRAFT",
    );
    const hasAnsweredRfi = allRfiItems.some(
      (r) => r.status === "ANSWERED",
    );
    const hasClosedRfi = allRfiItems.some(
      (r) => r.status === "CLOSED",
    );

    // Also check KYC-level RFI status strings
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

    if (hasPendingRfi || hasKycOpenRfi) {
      rfiStatus = "Open";
    } else if (hasAnsweredRfi || hasClosedRfi || hasKycClosedRfi) {
      rfiStatus = "Closed";
    } else {
      rfiStatus = "None";
    }

    // ------ Step 5: Determine routing ------
    const missingInputs: string[] = [];
    const conflicts: string[] = [];

    // Track extracted user/email info
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

    // Check for PA Risk Ops signals (highest priority)
    // PA signals: watchlist hits (sanctions, PEP, credit concern, adverse media),
    // TM case domains with PA/RISK_OPS/CREDIT indicators
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

    const paCases = tmCases.filter(
      (c) =>
        c.domains?.some(
          (d) =>
            d.toUpperCase().includes("PA") ||
            d.toUpperCase().includes("RISK_OPS") ||
            d.toUpperCase().includes("CREDIT"),
        ),
    );

    // Check for active KYC cases
    const activeKycCases = kycCases.filter(
      (c) =>
        c.caseStatus &&
        !["CLOSED", "COMPLETED", "REJECTED", "CANCELLED"].includes(
          c.caseStatus.toUpperCase(),
        ),
    );

    // Check for active TM cases (non-PA)
    const activeTmCases = tmCases.filter(
      (c) =>
        c.status &&
        !["CLOSED", "COMPLETED", "RESOLVED"].includes(
          c.status.toUpperCase(),
        ) &&
        !paCases.includes(c),
    );

    // Check for pending cardholders
    const pendingCardholders = cardholders.filter(
      (ch) =>
        ch.status &&
        ch.status.toUpperCase().includes("PENDING"),
    );

    // ------ Routing Decision Logic ------
    let routingCategory: RoutingCategory;
    let escalationPoint: string;
    let currentStatus: string;
    let whatIsOutstanding: string;
    let suggestedInternalAction: string;

    if (paCases.length > 0 || hasWatchlistPaSignal) {
      // Route to PA Risk Ops
      routingCategory = "PA Risk Ops";
      if (hasWatchlistPaSignal && paCases.length === 0) {
        escalationPoint = `Watchlist hit: ${watchlistCategories.join(", ")}`;
        currentStatus = `${watchlistHitCount} watchlist hit(s) detected — categories: ${watchlistCategories.join(", ")}`;
      } else {
        escalationPoint = "PA Risk Ops case or restriction";
        currentStatus = `PA case status: ${paCases[0].status ?? "Unknown"}`;
      }
      whatIsOutstanding =
        rfiStatus === "Open"
          ? "Customer verification request outstanding; PA case active"
          : hasWatchlistPaSignal
            ? `Watchlist match requires PA Risk Ops review (${watchlistCategories.join(", ")})`
            : "PA Risk Ops review in progress";
      suggestedInternalAction =
        "Escalate to PA Risk Ops queue. Do not route to KYC.";
    } else if (activeKycCases.length > 0 || pendingCardholders.length > 0) {
      // Route to KYC (includes cardholder verification)
      routingCategory = "KYC";
      const kycCase = activeKycCases[0] ?? null;
      const reviewType = kycCase?.reviewType ?? null;

      if (pendingCardholders.length > 0 && activeKycCases.length === 0) {
        escalationPoint = "Pending cardholder verification";
        currentStatus = `Cardholder status: ${pendingCardholders[0].status}`;
      } else {
        escalationPoint = reviewType
          ? `KYC ${reviewType}`
          : "Active KYC case";
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
    } else if (
      activeTmCases.length > 0 ||
      input.transactionId ||
      input.depositId ||
      input.payoutId
    ) {
      // Route to TM
      routingCategory = "TM";
      const tmCase = activeTmCases[0] ?? null;

      if (input.depositId) {
        escalationPoint = "Deposit in review";
      } else if (input.payoutId) {
        escalationPoint = "Payout in review";
      } else if (input.transactionId) {
        escalationPoint = "Transaction in review";
      } else {
        escalationPoint = "TM case active";
      }

      currentStatus = tmCase
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
    } else if (!hasAnyCases) {
      // Account found but no cases at all
      routingCategory = "CS";
      escalationPoint = "Account found — no active cases";
      currentStatus = accountInfo?.status
        ? `Account status: ${accountInfo.status}`
        : "Active (no open cases)";

      whatIsOutstanding =
        "No open KYC, TM, or PA Risk Ops cases found for this account.";

      suggestedInternalAction =
        "No internal escalation needed. If the customer reports a specific issue, re-analyse with ticket context.";
    } else {
      // Route to CS (fallback) — cases exist but none are active/matching
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

    // ------ Step 6: Build customer message ------
    let customerMessage = RFI_MESSAGES[rfiStatus];

    // Enhance with context
    if (routingCategory === "TM" && rfiStatus === "None") {
      customerMessage =
        "No open verification request is showing. The relevant team will check the current transaction status.";
    } else if (routingCategory === "CS") {
      customerMessage =
        "We are looking into this for you. Could you share any additional details about the issue so we can assist further?";
    }

    // ------ Step 7: Check for conflicts ------
    // Ticket context mentions KYC but no KYC case found
    if (
      input.ticketContext &&
      input.ticketContext.toLowerCase().includes("kyc") &&
      activeKycCases.length === 0
    ) {
      conflicts.push(
        "Ticket mentions KYC but no active KYC case found for this account",
      );
    }

    // Ticket mentions transaction but no TM case
    if (
      input.ticketContext &&
      (input.ticketContext.toLowerCase().includes("transaction") ||
        input.ticketContext.toLowerCase().includes("deposit") ||
        input.ticketContext.toLowerCase().includes("payout")) &&
      activeTmCases.length === 0 &&
      routingCategory !== "TM"
    ) {
      conflicts.push(
        "Ticket mentions transaction/deposit/payout but no active TM case found",
      );
    }

    // ------ Step 8: Build recommendation ------
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
      },
      missingInputs,
      conflicts,
    };

    return { recommendation, error: null };
  },
});
