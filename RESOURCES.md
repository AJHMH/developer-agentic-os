# Hosted and Local Application Modes Resources

## Knowledge

- [Next.js: Project Structure](https://nextjs.org/docs/app/getting-started/project-structure)
  Official reference for how App Router pages and server-side entry points organize an application. Use it when locating the route that selects the application shell.
- [Next.js: Environment Variables](https://nextjs.org/docs/app/guides/environment-variables)
  Official reference for environment-dependent behavior in Next.js applications. Use it when reasoning about the `VERCEL` mode switch and server-only configuration.
- [Clerk: Next.js App Router Authentication](https://clerk.com/docs/references/nextjs/overview)
  Official authentication reference for the hosted request boundary. Use it when tracing `hostedIdentity` and protected routes.
- [Neon: Serverless Postgres](https://neon.tech/docs/introduction)
  Official overview of the hosted persistence service used by the application. Use it after understanding the mode boundary and tenant-scoped state.

## Wisdom

No community resource is needed for this first lesson. The goal is repository-specific orientation.

## Gaps

The repository-specific architecture is the primary source for this lesson; future lessons should add resources for tenant isolation, webhook security, and deployment lifecycle once the mode split is familiar.
