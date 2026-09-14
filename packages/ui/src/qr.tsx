import { View } from 'react-native';
import QRCode from 'react-native-qrcode-svg';
import { color as C, radius } from './tokens';
/** Pickup QR shown by the customer; the partner app scans `bugsha://redeem/<CODE>`. */
export function QrCode({ value, size = 168 }: { value: string; size?: number }) {
  return <View style={{ padding: 12, backgroundColor: '#FFFFFF', borderRadius: radius.card, borderWidth: 1, borderColor: C.borderSubtle, alignSelf: 'center' }}><QRCode value={value} size={size} color="#17141F" backgroundColor="#FFFFFF" ecl="M" /></View>;
}
export const redeemDeepLink = (code: string) => `bugsha://redeem/${code}`;
