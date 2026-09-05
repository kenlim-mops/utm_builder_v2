export const openApiDocument = {
  openapi: "3.1.0",
  info: {
    title: "Runpod UTM Registry API",
    version: "1.0.0",
    description: "Supported API for governed initiative, campaign, link, and batch operations.",
  },
  servers: [{ url: "/api/v1" }],
  components: {
    securitySchemes: {
      bearerAuth: { type: "http", scheme: "bearer" },
    },
    schemas: {
      CampaignRequest: {
        type: "object",
        required: ["name"],
        properties: {
          name: { type: "string", maxLength: 160 },
          ownerId: { type: "string", description: "Optional owner assignment; assigning another user requires admin role" },
          utmCampaign: { type: "string", maxLength: 100 },
          initiativeId: { type: ["string", "null"] },
          product: { type: ["string", "null"] },
          campaignType: { type: ["string", "null"] },
          startDate: { type: ["string", "null"] },
          endDate: { type: ["string", "null"] },
          description: { type: ["string", "null"] },
          duplicateAction: { type: ["string", "null"], enum: ["override", null] },
          duplicateReason: { type: ["string", "null"], maxLength: 1000 },
        },
      },
      LinkRequest: {
        type: "object",
        required: ["destination", "campaignId", "utmSource", "utmMedium"],
        properties: {
          destination: { type: "string" }, campaignId: { type: "string" },
          presetKey: { type: "string" }, utmSource: { type: "string" },
          utmMedium: { type: "string" }, utmContent: { type: ["string", "null"] },
          utmTerm: { type: ["string", "null"] },
        },
      },
    },
  },
  security: [{ bearerAuth: [] }],
  paths: {
    "/session": { get: { summary: "Get the authenticated API principal" } },
    "/initiatives": {
      get: { summary: "List initiatives" },
      post: { summary: "Create an initiative" },
    },
    "/campaigns": {
      get: { summary: "List campaigns" },
      post: {
        summary: "Create a campaign; semantic duplicates return candidates for reuse",
        requestBody: { required: true, content: { "application/json": { schema: { $ref: "#/components/schemas/CampaignRequest" } } } },
      },
    },
    "/taxonomy": { get: { summary: "List governed taxonomy" } },
    "/presets": { get: { summary: "List platform presets" } },
    "/links/preview": {
      post: {
        summary: "Validate and preview a governed URL without writing",
        requestBody: { required: true, content: { "application/json": { schema: { $ref: "#/components/schemas/LinkRequest" } } } },
      },
    },
    "/links": {
      get: { summary: "Search the link registry" },
      post: {
        summary: "Issue a governed URL",
        parameters: [{ name: "Idempotency-Key", in: "header", required: true, schema: { type: "string", minLength: 8, maxLength: 200 } }],
        requestBody: { required: true, content: { "application/json": { schema: { $ref: "#/components/schemas/LinkRequest" } } } },
      },
    },
    "/batches": { post: { summary: "Issue up to 200 governed URLs" } },
  },
} as const;
