import { StyleSheet, View } from 'react-native';
import { WebView } from 'react-native-webview';
import Constants from 'expo-constants';

function waylyUrl() {
  const raw =
    Constants.expoConfig?.hostUri ??
    Constants.expoGoConfig?.debuggerHost ??
    '';
  const host = raw.replace(/^[a-z][a-z0-9+.-]*:\/\//i, '').split('/')[0].split(':')[0];
  return host ? `http://${host}:3000` : 'http://localhost:3000';
}

// The site is a 390px column on a beige canvas. On a phone that column leaves side bars.
const fillPhoneScreen = `
  (function () {
    function apply() {
      if (!document.documentElement || document.getElementById('wayly-phone-fit')) return;
      var style = document.createElement('style');
      style.id = 'wayly-phone-fit';
      style.textContent = 'html,body,main{background:#fcfaf5!important}main>div[class*="max-w-"]{max-width:none!important;width:100%!important;box-shadow:none!important}[class*="max-w-[390px]"],[class*="max-w-[350px]"]{max-width:100%!important}';
      (document.head || document.documentElement).appendChild(style);
    }
    apply();
    document.addEventListener('DOMContentLoaded', apply);
  })();
  true;
`;

export default function App() {
  return (
    <View style={styles.screen}>
      <WebView
        source={{ uri: waylyUrl() }}
        style={styles.webview}
        injectedJavaScriptBeforeContentLoaded={fillPhoneScreen}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#fcfaf5' },
  webview: { flex: 1, marginTop: Constants.statusBarHeight, backgroundColor: '#fcfaf5' },
});
