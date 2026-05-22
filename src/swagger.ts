import swaggerJsdoc from 'swagger-jsdoc';

const options = {
  definition: {
    openapi: '3.0.0',
    info: {
      title: 'Finley Payroll Backend API',
      version: '1.0.0',
      description: 'API Documentation for Finley Payroll Backend',
    },
    components: {
      securitySchemes: {
        bearerAuth: {
          type: 'http',
          scheme: 'bearer',
          bearerFormat: 'JWT',
        },
      },
    },
    security: [
      {
        bearerAuth: [],
      },
    ],
    paths: {
      '/health': {
        get: {
          summary: 'Check API Health',
          tags: ['System'],
          responses: { '200': { description: 'OK' } }
        }
      },
      '/auth/login': {
        post: {
          summary: 'Login with Web3 Signature',
          tags: ['Auth'],
          security: [],
          requestBody: {
            required: true,
            content: { 'application/json': { schema: { type: 'object', properties: { address: { type: 'string' }, message: { type: 'string' }, signature: { type: 'string' } } } } }
          },
          responses: { '200': { description: 'Returns access & refresh tokens' } }
        }
      },
      '/auth/refresh': {
        post: {
          summary: 'Refresh Access Token',
          tags: ['Auth'],
          security: [],
          requestBody: {
            required: true,
            content: { 'application/json': { schema: { type: 'object', properties: { refreshToken: { type: 'string' } } } } }
          },
          responses: { '200': { description: 'Returns new access token' } }
        }
      },
      '/auth/logout': {
        post: {
          summary: 'Logout and Revoke Session',
          tags: ['Auth'],
          responses: { '200': { description: 'Successfully logged out' } }
        }
      },
      '/auth/profile': {
        get: {
          summary: 'Get Employee Profile',
          tags: ['Auth'],
          responses: { '200': { description: 'Returns decrypted PII data' } }
        },
        post: {
          summary: 'Update Employee Profile',
          tags: ['Auth'],
          requestBody: {
            required: true,
            content: { 'application/json': { schema: { type: 'object', properties: { name: { type: 'string' }, nik: { type: 'string' }, phone: { type: 'string' } } } } }
          },
          responses: { '200': { description: 'Profile saved' } }
        }
      },
      '/bundler/relay': {
        post: {
          summary: 'Relay Gasless Transaction (UserOp)',
          tags: ['Bundler'],
          requestBody: {
            required: true,
            content: { 'application/json': { schema: { type: 'object', properties: { userOp: { type: 'object' } } } } }
          },
          responses: { '200': { description: 'UserOp hash returned' } }
        }
      },
      '/bundler/status/{userOpHash}': {
        get: {
          summary: 'Get UserOp Status',
          tags: ['Bundler'],
          parameters: [{ name: 'userOpHash', in: 'path', required: true, schema: { type: 'string' } }],
          responses: { '200': { description: 'Status details' } }
        }
      },
      '/compliance/summary/{hr}': {
        get: {
          summary: 'Get Compliance Summary',
          tags: ['Compliance'],
          parameters: [{ name: 'hr', in: 'path', required: true, schema: { type: 'string' } }],
          responses: { '200': { description: 'Summary data' } }
        }
      },
      '/compliance/export/{hr}': {
        get: {
          summary: 'Export Compliance Data as CSV',
          tags: ['Compliance'],
          parameters: [{ name: 'hr', in: 'path', required: true, schema: { type: 'string' } }],
          responses: { '200': { description: 'CSV file' } }
        }
      },
      '/webhook/alchemy': {
        post: {
          summary: 'Receive Alchemy Webhooks',
          tags: ['Webhook'],
          security: [],
          responses: { '200': { description: 'Webhook processed' } }
        }
      }
    }
  },
  apis: [], // Defined inline above
};

export const swaggerSpecs = swaggerJsdoc(options);
