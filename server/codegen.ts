import type { CodegenConfig } from '@graphql-codegen/cli';

const config: CodegenConfig = {
  schema: 'src/graphql/schema/**/*.graphql',
  generates: {
    'src/generated/graphql.ts': {
      plugins: ['typescript', 'typescript-resolvers'],
      config: {
        useIndexSignature: true,
        // Context and model mappers are wired up in a later task, once there
        // is a real request context and Prisma model types to map onto.
        contextType: 'unknown',
      },
    },
  },
};

export default config;
