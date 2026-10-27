import Constants from 'expo-constants';

/** True when running inside the Expo Go client (not a dev build or store build). */
export function isExpoGo(): boolean {
  return Constants.appOwnership === 'expo';
}
