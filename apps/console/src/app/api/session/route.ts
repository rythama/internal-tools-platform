/** Dev session issuer: mints the signed cookie the rest of the app reads (§3.2). */
import { NextResponse } from 'next/server';
import {
  DEFAULT_ROLE,
  SESSION_COOKIE,
  actorForRole,
  encodeSession,
  isRole,
} from '../../../lib/session';

export async function POST(request: Request): Promise<NextResponse> {
  const form = await request.formData();
  const requested = form.get('role');
  const role = typeof requested === 'string' && isRole(requested) ? requested : DEFAULT_ROLE;
  const referer = request.headers.get('referer');

  const response = NextResponse.redirect(new URL(referer ?? '/', request.url), 303);
  response.cookies.set(SESSION_COOKIE, encodeSession(actorForRole(role)), {
    httpOnly: true,
    sameSite: 'lax',
    path: '/',
  });
  return response;
}
