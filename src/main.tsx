import { render } from 'preact';
import { registerSW } from 'virtual:pwa-register';
import { App } from './app';
import { startSyncLoop } from './data/sync';
import { loadIdentity } from './data/workspace';
import '@fontsource/barlow-condensed/latin-700.css';
import '@fontsource/ibm-plex-mono/latin-500.css';
import '@fontsource/ibm-plex-mono/latin-600.css';
import '@fontsource/ibm-plex-sans/latin-400.css';
import '@fontsource/ibm-plex-sans/latin-500.css';
import '@fontsource/ibm-plex-sans/latin-600.css';
import '@fontsource/ibm-plex-sans/latin-700.css';
import './styles.css';

registerSW({ immediate: true });

void loadIdentity().then(startSyncLoop);
render(<App />, document.getElementById('app')!);
