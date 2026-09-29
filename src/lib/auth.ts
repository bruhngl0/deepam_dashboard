export async function requireUser(): Promise<string> {
  return 'local-user';
}

export async function requireApiUser(): Promise<string | Response> {
  return 'local-user';
}
