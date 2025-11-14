import dotenv from 'dotenv';
dotenv.config();
import app from './app.js';
const PORT = process.env.PORT || 4000;
app.listen(PORT, '0.0.0.0', () => console.log('API v2 listening on ' + PORT));
