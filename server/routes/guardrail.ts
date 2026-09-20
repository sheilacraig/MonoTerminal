import { Router } from 'express';
import { checkCommandSafety } from '../guardrail';

export const guardrailRouter = Router();

// POST /api/guardrail/check
guardrailRouter.post('/check', (req, res) => {
  const { command } = req.body;
  const result = checkCommandSafety(command);
  res.json({ success: true, data: result });
});
