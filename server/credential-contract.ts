import { z } from 'zod';

// New accounts use the same strict limits on every creation and password reset path.
export const accountUsernameSchema = z.string().trim().min(3).max(80).regex(/^[a-zA-Z0-9_.@-]+$/);
export const accountPasswordSchema = z.string().min(6).max(128);

// Older releases could persist printable usernames and passwords up to these limits.
// Preserve those credentials at login while rejecting Unicode control/format characters.
export const loginUsernameSchema = z.string().trim().min(3).max(100).refine(value => !/\p{C}/u.test(value));
export const loginPasswordSchema = z.string().min(1).max(200);

export const accountCredentialFields = {
  username: accountUsernameSchema,
  password: accountPasswordSchema,
};
