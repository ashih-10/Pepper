import { Redirect } from 'expo-router';

/** Landing spot for the Google sign-in redirect; the auth state takes it from here. */
export default function AuthCallback() {
  return <Redirect href="/" />;
}
