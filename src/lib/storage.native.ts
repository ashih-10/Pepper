// On phones, expo-sqlite provides a persistent `localStorage` so the login
// session survives app restarts.
import 'expo-sqlite/localStorage/install';

export const isWeb = false;
