import { api, z, graphql } from "@superblocksteam/sdk-api";

// Integration IDs — use account-settings as the primary resolver
const ACCOUNT_SETTINGS = "25c0f7da-e324-4125-bdd9-4ce506dcac32";
const RISK_COMMON_BFF = "df44a1a6-0d90-483f-9e22-265df78e5250";

export default api({
  name: "ResolveAccount",
  description:
    "Lightweight account existence check. Returns account info if found in the current data tag.",

  integrations: {
    account_settings: graphql(ACCOUNT_SETTINGS),
    risk_common_bff: graphql(RISK_COMMON_BFF),
  },

  input: z.object({
    accountId: z.string(),
    airboardToken: z.string().nullable(),
  }),

  output: z.object({
    found: z.boolean(),
    owningEntity: z.string().nullable(),
    dataCenter: z.string().nullable(),
    status: z.string().nullable(),
    businessName: z.string().nullable(),
    source: z.string().nullable(),
    error: z.string().nullable(),
  }),

  async run(ctx, { accountId, airboardToken }) {
    // Derive auth headers per org knowledge:
    // GraphQL integrations use raw token (no Bearer prefix).
    // If airboardToken is absent (staging fallback), omit headers entirely.
    const graphqlHeaders = airboardToken
      ? { Authorization: airboardToken }
      : undefined;

    if (!accountId || accountId.trim() === "") {
      return {
        found: false,
        owningEntity: null,
        dataCenter: null,
        status: null,
        businessName: null,
        source: null,
        error: "Account ID is required.",
      };
    }

    // Try account-settings first (fastest, most authoritative)
    try {
      const accountResult = await ctx.integrations.account_settings.query(
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
            errors: z
              .array(z.object({ message: z.string() }))
              .optional(),
          }),
        },
        undefined,
        { label: "Resolve account via account-settings" },
        graphqlHeaders,
      );

      if (accountResult.data?.account?.id) {
        return {
          found: true,
          owningEntity: accountResult.data.account.owningEntity ?? null,
          dataCenter: accountResult.data.account.dataCenter ?? null,
          status: accountResult.data.account.status ?? null,
          businessName: accountResult.data.account.businessName ?? null,
          source: "account-settings",
          error: null,
        };
      }
    } catch {
      // account-settings failed — try fallback
    }

    // Fallback: try risk-common-bff getLegalEntityBriefByAccountId
    try {
      const cleResult = await ctx.integrations.risk_common_bff.query(
        `query {
          getLegalEntityBriefByAccountId(accountId: "${accountId}") {
            id
            owningEntity
            status
            type
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
                    type: z.string().nullable().optional(),
                  })
                  .nullable(),
              })
              .nullable(),
            errors: z
              .array(z.object({ message: z.string() }))
              .optional(),
          }),
        },
        undefined,
        { label: "Resolve account via risk-common-bff CLE lookup" },
        graphqlHeaders,
      );

      if (cleResult.data?.getLegalEntityBriefByAccountId?.id) {
        return {
          found: true,
          owningEntity:
            cleResult.data.getLegalEntityBriefByAccountId.owningEntity ?? null,
          dataCenter: null,
          status:
            cleResult.data.getLegalEntityBriefByAccountId.status ?? null,
          businessName: null,
          source: "risk-common-bff",
          error: null,
        };
      }
    } catch {
      // CLE also failed
    }

    // Account not found in this data tag
    return {
      found: false,
      owningEntity: null,
      dataCenter: null,
      status: null,
      businessName: null,
      source: null,
      error: null,
    };
  },
});
