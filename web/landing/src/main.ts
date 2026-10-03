import { BUILD_LABEL } from '../../shared/src/build';

const app = document.querySelector<HTMLElement>('#app');
if (app) app.textContent = `${BUILD_LABEL} · landing`;
