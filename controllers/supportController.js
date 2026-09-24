import {
  addMyMessage,
  adminAddMessage,
  adminGetTicket,
  adminListTickets,
  adminOverview,
  adminUpdateTicket,
  createTicket,
  getMyTicket,
  listMyTickets,
  updateMyTicketStatus,
} from '../services/help/supportService.js';

export const createSupportTicket = async (req, res) => {
  try {
    const ticket = await createTicket(req.user, req.body || {});
    res.status(201).json({ message: 'Support request created.', ticket });
  } catch (error) {
    if (error.status) {
      return res.status(error.status).json({ error: error.message });
    }
    console.error('Create support ticket error:', error);
    res.status(500).json({ error: 'Unable to create this support request.' });
  }
};

export const getMySupportTickets = async (req, res) => {
  try {
    const tickets = await listMyTickets(req.user.userId, { status: req.query.status });
    res.status(200).json(tickets);
  } catch (error) {
    console.error('List support tickets error:', error);
    res.status(500).json({ error: 'Unable to load your support requests.' });
  }
};

export const getMySupportTicket = async (req, res) => {
  try {
    const ticket = await getMyTicket(req.user.userId, req.params.id);
    res.status(200).json(ticket);
  } catch (error) {
    if (error.status) {
      return res.status(error.status).json({ error: error.message });
    }
    console.error('Get support ticket error:', error);
    res.status(500).json({ error: 'Unable to load this support request.' });
  }
};

export const replyMySupportTicket = async (req, res) => {
  try {
    const ticket = await addMyMessage(req.user, req.params.id, req.body?.message);
    res.status(201).json({ message: 'Reply sent.', ticket });
  } catch (error) {
    if (error.status) {
      return res.status(error.status).json({ error: error.message });
    }
    console.error('Reply support ticket error:', error);
    res.status(500).json({ error: 'Unable to send this reply.' });
  }
};

export const patchMySupportTicketStatus = async (req, res) => {
  try {
    const ticket = await updateMyTicketStatus(req.user.userId, req.params.id, req.body?.status);
    res.status(200).json({ message: 'Support request updated.', ticket });
  } catch (error) {
    if (error.status) {
      return res.status(error.status).json({ error: error.message });
    }
    console.error('Update support ticket status error:', error);
    res.status(500).json({ error: 'Unable to update this support request.' });
  }
};

export const adminGetSupportOverview = async (_req, res) => {
  try {
    const overview = await adminOverview();
    res.status(200).json(overview);
  } catch (error) {
    console.error('Admin support overview error:', error);
    res.status(500).json({ error: 'Unable to load support overview.' });
  }
};

export const adminGetSupportTickets = async (req, res) => {
  try {
    const tickets = await adminListTickets({
      status: req.query.status,
      priority: req.query.priority,
      category: req.query.category,
      search: req.query.search,
    });
    res.status(200).json(tickets);
  } catch (error) {
    console.error('Admin list support tickets error:', error);
    res.status(500).json({ error: 'Unable to load support requests.' });
  }
};

export const adminGetSupportTicket = async (req, res) => {
  try {
    const ticket = await adminGetTicket(req.params.id);
    res.status(200).json(ticket);
  } catch (error) {
    if (error.status) {
      return res.status(error.status).json({ error: error.message });
    }
    console.error('Admin get support ticket error:', error);
    res.status(500).json({ error: 'Unable to load this support request.' });
  }
};

export const adminReplySupportTicket = async (req, res) => {
  try {
    const ticket = await adminAddMessage(req.user, req.params.id, req.body?.message);
    res.status(201).json({ message: 'Reply sent.', ticket });
  } catch (error) {
    if (error.status) {
      return res.status(error.status).json({ error: error.message });
    }
    console.error('Admin reply support ticket error:', error);
    res.status(500).json({ error: 'Unable to send this reply.' });
  }
};

export const adminPatchSupportTicket = async (req, res) => {
  try {
    const ticket = await adminUpdateTicket(req.params.id, req.body || {});
    res.status(200).json({ message: 'Support request updated.', ticket });
  } catch (error) {
    if (error.status) {
      return res.status(error.status).json({ error: error.message });
    }
    console.error('Admin update support ticket error:', error);
    res.status(500).json({ error: 'Unable to update this support request.' });
  }
};
