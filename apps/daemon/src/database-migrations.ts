import { fileURLToPath } from 'node:url';

export const daemonMigrationsFolder = fileURLToPath(new URL('../drizzle', import.meta.url));
