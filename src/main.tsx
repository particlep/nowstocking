import { render } from 'preact';
import { registerSW } from 'virtual:pwa-register';
import { App } from './app';
import { loadFromIdb } from './data/store';
import { startSyncLoop } from './data/sync';
import './styles.css';

registerSW({ immediate: true });

void loadFromIdb().then(startSyncLoop);
render(<App />, document.getElementById('app')!);
