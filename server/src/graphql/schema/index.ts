import { Glob } from 'bun';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const schemaDir = dirname(fileURLToPath(import.meta.url));

/**
 * Loads every `*.graphql` file in this directory into a list of SDL documents.
 * Schema-first: adding a new `.graphql` file is all it takes to extend the API,
 * no registration step.
 */
export async function loadTypeDefs(): Promise<string[]> {
  const glob = new Glob('**/*.graphql');

  const files: string[] = [];
  for await (const file of glob.scan({ cwd: schemaDir })) {
    files.push(file);
  }

  // Deterministic order keeps schema-print output stable across machines.
  files.sort();

  if (files.length === 0) {
    throw new Error(`No .graphql schema files found in ${schemaDir}`);
  }

  return Promise.all(files.map((file) => Bun.file(join(schemaDir, file)).text()));
}
