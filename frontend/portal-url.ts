import { CUSTOMER_PORTAL_ORIGIN } from '../server/portal-origin';

export function customerPortalUrl(location: Location = window.location) {
  if (location.hostname === '127.0.0.1' || location.hostname === 'localhost') {
    const url = new URL('/portal/', location.origin);
    if (url.port === '5173') url.port = '5174';
    return url.href;
  }
  return CUSTOMER_PORTAL_ORIGIN + '/';
}
