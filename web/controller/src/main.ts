// The controller page (`B/c`, `B/j/<CODE>`). Until the controller app lands (C02), it runs the walking skeleton
// (P1-G00): join over WebRTC and send a stick.
import { mountHello } from './hello/hello';

const app = document.querySelector<HTMLElement>('#app');
if (app) void mountHello(app);
