import { ipc } from '@/lib/ipc';

export async function openSqlFile(): Promise<{ name: string; content: string } | null> {
  const result = await ipc.openSqlFile();
  if (!result) return null;
  const [name, content] = result;
  return { name, content };
}

export async function saveSqlFile(content: string, suggestedName = 'query.sql'): Promise<void> {
  await ipc.saveSqlFile(content, suggestedName);
}
