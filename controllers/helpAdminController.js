import {
  adminCreateFaq,
  adminDeleteFaq,
  adminGetFaq,
  adminListFaqs,
  adminUpdateFaq,
} from '../services/help/faqService.js';

export const adminGetFaqs = async (req, res) => {
  try {
    const faqs = await adminListFaqs({
      search: req.query.search,
      category: req.query.category,
      status: req.query.status,
    });
    res.status(200).json(faqs);
  } catch (error) {
    console.error('Admin list FAQs error:', error);
    res.status(500).json({ error: 'Unable to load FAQs.' });
  }
};

export const adminGetFaqById = async (req, res) => {
  try {
    const faq = await adminGetFaq(req.params.id);
    res.status(200).json(faq);
  } catch (error) {
    if (error.status) {
      return res.status(error.status).json({ error: error.message });
    }
    console.error('Admin get FAQ error:', error);
    res.status(500).json({ error: 'Unable to load this FAQ.' });
  }
};

export const adminCreateFaqHandler = async (req, res) => {
  try {
    const faq = await adminCreateFaq(req.body || {}, req.user.userId);
    res.status(201).json({ message: 'FAQ created.', faq });
  } catch (error) {
    if (error.status) {
      return res.status(error.status).json({ error: error.message });
    }
    console.error('Admin create FAQ error:', error);
    res.status(500).json({ error: 'Unable to create this FAQ.' });
  }
};

export const adminUpdateFaqHandler = async (req, res) => {
  try {
    const faq = await adminUpdateFaq(req.params.id, req.body || {});
    res.status(200).json({ message: 'FAQ updated.', faq });
  } catch (error) {
    if (error.status) {
      return res.status(error.status).json({ error: error.message });
    }
    console.error('Admin update FAQ error:', error);
    res.status(500).json({ error: 'Unable to update this FAQ.' });
  }
};

export const adminDeleteFaqHandler = async (req, res) => {
  try {
    await adminDeleteFaq(req.params.id);
    res.status(200).json({ message: 'FAQ removed.' });
  } catch (error) {
    if (error.status) {
      return res.status(error.status).json({ error: error.message });
    }
    console.error('Admin delete FAQ error:', error);
    res.status(500).json({ error: 'Unable to remove this FAQ.' });
  }
};
