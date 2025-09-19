import fs from 'fs';
import path from 'path';
import { buildServer } from '../buildServer';

async function exportOpenApi() {
  const server = await buildServer();

  await server.ready();

  const spec = server.swagger();
  const filePath = path.join(process.cwd(), 'openapi.json');
  fs.writeFileSync(filePath, JSON.stringify(spec, null, 2));

  console.log(`OpenAPI spec exported to ${filePath}`);

  await server.close();
}

exportOpenApi().catch((err) => {
  console.error('Failed to export OpenAPI spec:', err);
  process.exit(1);
});
