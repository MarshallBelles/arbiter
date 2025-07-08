import { NextApiRequest, NextApiResponse } from 'next';
import Joi from 'joi';
import { sanitizeExecutionInput } from '@/lib/utils/sanitization';
import { getArbiterService } from '@/lib/services/service-manager';

const executeWorkflowSchema = Joi.object({
  data: Joi.any().required(),
});

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const { id } = req.query;
  const service = await getArbiterService();

  if (typeof id !== 'string') {
    return res.status(400).json({ error: 'Invalid workflow ID' });
  }

  if (req.method !== 'POST') {
    res.setHeader('Allow', ['POST']);
    return res.status(405).json({ message: 'Method not allowed' });
  }

  try {
    // Validate request body
    const { error, value } = executeWorkflowSchema.validate(req.body);
    if (error) {
      return res.status(400).json({
        error: 'Validation failed',
        details: error.details.map(d => d.message),
      });
    }

    // Sanitize execution input
    const sanitizedInput = sanitizeExecutionInput(value.data);

    // Create event and execute workflow
    const event = {
      id: `execution-${Date.now()}-${Math.random().toString(36).slice(2)}`,
      type: 'api' as const,
      source: 'api',
      timestamp: new Date(),
      data: sanitizedInput,
    };

    const execution = await service.executeWorkflow(id, event);
    res.status(200).json(execution);

  } catch (error) {
    console.error('Workflow execution error:', error);
    res.status(500).json({
      error: 'Execution failed',
      message: error instanceof Error ? error.message : 'Unknown error',
    });
  }
}