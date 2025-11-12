// src/utils/notificationEvents.js
import { EventEmitter } from 'events';

const notificationEvents = new EventEmitter();
notificationEvents.setMaxListeners(0); // множество подписчиков (SSE-потоков)

export default notificationEvents;
