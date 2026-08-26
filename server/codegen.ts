import type { CodegenConfig } from '@graphql-codegen/cli';

const config: CodegenConfig = {
  schema: 'src/graphql/schema/**/*.graphql',
  generates: {
    'src/generated/graphql.ts': {
      plugins: ['typescript', 'typescript-resolvers'],
      config: {
        useIndexSignature: true,
        // Every resolver is typed against the real request context.
        contextType: '../graphql/context.ts#GraphQLContext',
        // Resolver parents are the domain shapes the services actually return,
        // not the GraphQL output types — so dates stay Date internally and are
        // formatted to ISO 8601 by their field resolvers.
        mappers: {
          User: '../services/auth/authService.ts#PublicUser',
          // Aliased: the service type shares its name with the generated
          // GraphQL output type, which would collide on import.
          AuthPayload: '../services/auth/authService.ts#AuthPayload as AuthPayloadModel',
          Ticket: '../repositories/ticketRepository.ts#TicketRecord',
          Comment: '../repositories/commentRepository.ts#CommentRecord',
          Holiday: '../repositories/holidayRepository.ts#HolidayRecord',
          SLAInfo: '../services/ticket/slaView.ts#SlaView',
          TicketDashboard: '../repositories/ticketRepository.ts#DashboardCounts',
        },
      },
    },
  },
};

export default config;
