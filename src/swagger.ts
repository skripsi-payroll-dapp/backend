import swaggerJsdoc from 'swagger-jsdoc';

const options = {
  definition: {
    openapi: '3.0.0',
    info: {
      title: 'Finley Payroll Backend API',
      version: '1.0.0',
      description: 'REST API for Finley Payroll — auth, compliance export, gasless bundler relay, and Alchemy webhooks.',
    },
    components: {
      securitySchemes: {
        bearerAuth: {
          type: 'http',
          scheme: 'bearer',
          bearerFormat: 'JWT',
        },
      },
      schemas: {
        TokenPair: {
          type: 'object',
          properties: {
            accessToken:  { type: 'string' },
            refreshToken: { type: 'string' },
          },
        },
        Profile: {
          type: 'object',
          properties: {
            address: { type: 'string', example: '0xabc...' },
            name:    { type: 'string', example: 'Budi Santoso' },
            nik:     { type: 'string', example: '3171xxxxxx' },
            phone:   { type: 'string', example: '08xx' },
          },
        },
        ComplianceSummary: {
          type: 'object',
          properties: {
            month:           { type: 'string', example: '2025-01' },
            hrAddress:       { type: 'string' },
            employeeCount:   { type: 'string' },
            totalAccrued:    { type: 'string', description: 'IDRX wei (18 decimals)' },
            totalCompliance: { type: 'string', description: 'IDRX wei — BPJS + PPh21' },
            totalSeverance:  { type: 'string', description: 'IDRX wei' },
            rows: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  employee:         { type: 'string' },
                  claim_count:      { type: 'string' },
                  total_accrued:    { type: 'string' },
                  total_compliance: { type: 'string' },
                  total_severance:  { type: 'string' },
                },
              },
            },
          },
        },
        Error: {
          type: 'object',
          properties: {
            error:   { type: 'string' },
            code:    { type: 'string' },
            message: { type: 'string' },
          },
        },
      },
    },
    security: [{ bearerAuth: [] }],
    paths: {
      '/health': {
        get: {
          summary: 'Health check',
          tags: ['System'],
          security: [],
          responses: { '200': { description: 'OK' } },
        },
      },

      // ── Auth ────────────────────────────────────────────────────────────────
      '/auth/login': {
        post: {
          summary: 'Login with Web3 signature (EIP-191)',
          tags: ['Auth'],
          security: [],
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  required: ['address', 'message', 'signature'],
                  properties: {
                    address:   { type: 'string', example: '0xabc...' },
                    message:   { type: 'string', example: 'Sign in to Finley at 1234567890' },
                    signature: { type: 'string', example: '0xsig...' },
                  },
                },
              },
            },
          },
          responses: {
            '200': {
              description: 'Returns access & refresh tokens',
              content: { 'application/json': { schema: { $ref: '#/components/schemas/TokenPair' } } },
            },
            '401': { description: 'Invalid signature', content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } },
          },
        },
      },
      '/auth/refresh': {
        post: {
          summary: 'Refresh access token',
          tags: ['Auth'],
          security: [],
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  required: ['refreshToken'],
                  properties: { refreshToken: { type: 'string' } },
                },
              },
            },
          },
          responses: {
            '200': { description: 'New access token', content: { 'application/json': { schema: { $ref: '#/components/schemas/TokenPair' } } } },
            '401': { description: 'Invalid or expired refresh token' },
          },
        },
      },
      '/auth/logout': {
        post: {
          summary: 'Logout and revoke session',
          tags: ['Auth'],
          responses: { '200': { description: 'Session revoked' } },
        },
      },
      '/auth/profile': {
        get: {
          summary: 'Get own employee profile (decrypted PII)',
          tags: ['Auth'],
          responses: {
            '200': { description: 'Profile data', content: { 'application/json': { schema: { $ref: '#/components/schemas/Profile' } } } },
            '404': { description: 'Profile not found' },
          },
        },
        post: {
          summary: 'Create or update employee profile (PII encrypted at rest)',
          tags: ['Auth'],
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  required: ['name', 'nik', 'phone'],
                  properties: {
                    name:  { type: 'string' },
                    nik:   { type: 'string', description: '16-digit NIK' },
                    phone: { type: 'string' },
                  },
                },
              },
            },
          },
          responses: { '200': { description: 'Profile saved' } },
        },
      },

      // ── Bundler ─────────────────────────────────────────────────────────────
      '/bundler/relay': {
        post: {
          summary: 'Relay gasless ERC-4337 UserOperation via Pimlico',
          tags: ['Bundler'],
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  required: ['userOp'],
                  properties: { userOp: { type: 'object', description: 'Packed ERC-4337 UserOperation' } },
                },
              },
            },
          },
          responses: {
            '200': {
              description: 'UserOp submitted',
              content: {
                'application/json': {
                  schema: { type: 'object', properties: { userOpHash: { type: 'string' } } },
                },
              },
            },
            '400': { description: 'Invalid UserOp' },
          },
        },
      },
      '/bundler/status/{userOpHash}': {
        get: {
          summary: 'Poll UserOp execution status',
          tags: ['Bundler'],
          parameters: [{ name: 'userOpHash', in: 'path', required: true, schema: { type: 'string' } }],
          responses: {
            '200': {
              description: 'Status details',
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    properties: {
                      status: { type: 'string', enum: ['pending', 'success', 'failed'] },
                      txHash: { type: 'string' },
                    },
                  },
                },
              },
            },
          },
        },
      },

      // ── Compliance ───────────────────────────────────────────────────────────
      '/compliance/summary/{hr}': {
        get: {
          summary: 'Get monthly compliance summary (BPJS + PPh21)',
          description: 'Returns aggregate totals for all employee claims in a given month. HR can only query their own company.',
          tags: ['Compliance'],
          parameters: [
            { name: 'hr', in: 'path', required: true, schema: { type: 'string' }, description: 'HR wallet address' },
            { name: 'month', in: 'query', required: true, schema: { type: 'string', example: '2025-01' }, description: 'Month in YYYY-MM format' },
          ],
          responses: {
            '200': { description: 'Summary data', content: { 'application/json': { schema: { $ref: '#/components/schemas/ComplianceSummary' } } } },
            '400': { description: "Missing or invalid 'month' query param" },
            '403': { description: 'Forbidden — HR can only query their own company' },
            '404': { description: 'No claims found for this period' },
          },
        },
      },
      '/compliance/export/{hr}': {
        get: {
          summary: 'Export monthly compliance data as CSV',
          description: 'Downloads a CSV with per-employee BPJS/PPh21 breakdown including decrypted names. HR can only export their own company.',
          tags: ['Compliance'],
          parameters: [
            { name: 'hr', in: 'path', required: true, schema: { type: 'string' }, description: 'HR wallet address' },
            { name: 'month', in: 'query', required: true, schema: { type: 'string', example: '2025-01' }, description: 'Month in YYYY-MM format' },
          ],
          responses: {
            '200': { description: 'CSV file download', content: { 'text/csv': { schema: { type: 'string' } } } },
            '400': { description: "Missing or invalid 'month' query param" },
            '403': { description: 'Forbidden' },
            '404': { description: 'No claims found for this period' },
          },
        },
      },

      // ── Webhook ──────────────────────────────────────────────────────────────
      '/webhook/alchemy': {
        post: {
          summary: 'Receive Alchemy address activity webhooks',
          tags: ['Webhook'],
          security: [],
          responses: { '200': { description: 'Webhook processed' } },
        },
      },
    },
  },
  apis: [],
};

export const swaggerSpecs = swaggerJsdoc(options);
