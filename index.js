import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import authRoutes from './routes/authRoutes.js';
import meditationRoutes from './routes/meditationRoutes.js';
import eventsRoutes from './routes/eventsRoutes.js';
import communityRoutes from './routes/communityRoutes.js';
import volunteerRoutes from './routes/volunteerRoutes.js';
import notificationRoutes from './routes/notificationRoutes.js';
import helpRoutes from './routes/helpRoutes.js';
import supportRoutes from './routes/supportRoutes.js';
import { startNotificationScheduler } from './jobs/notificationScheduler.js';
import { ensureHelpSchema } from './services/help/ensureSchema.js';
dotenv.config();

const app = express();
const PORT = process.env.PORT || 5000;

app.use(cors());
app.use(express.json());

app.get('/', (req, res) => {
  res.send('Spiritual Platform API is running.');
});

app.use('/api/auth', authRoutes);
app.use('/api/meditation', meditationRoutes);
app.use('/uploads', express.static('uploads'));
app.use('/api/events', eventsRoutes);
app.use('/api/community', communityRoutes);
app.use('/api/volunteering', volunteerRoutes);
app.use('/api/notifications', notificationRoutes);
app.use('/api/help', helpRoutes);
app.use('/api/support', supportRoutes);

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
  startNotificationScheduler().catch((error) => {
    console.error('Notification scheduler startup error:', error);
  });
  ensureHelpSchema().catch((error) => {
    console.error('Help schema setup error:', error);
  });
});

