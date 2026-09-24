import {
  listActiveCategories,
  submitFaqFeedback,
} from '../services/help/faqService.js';
import {
  getPublishedFaqById,
  listPublishedFaqs,
  searchPublishedFaqs,
} from '../services/help/helpSearchService.js';

export const getHelpCategories = async (_req, res) => {
  try {
    const categories = await listActiveCategories();
    res.status(200).json(categories);
  } catch (error) {
    console.error('Get help categories error:', error);
    res.status(500).json({ error: 'Unable to load help categories.' });
  }
};

export const getHelpFaqs = async (req, res) => {
  try {
    const search = typeof req.query.search === 'string' ? req.query.search : '';
    const category = typeof req.query.category === 'string' ? req.query.category : '';

    if (search.trim()) {
      const faqs = await searchPublishedFaqs(search, {
        category,
        limit: req.query.limit,
      });
      return res.status(200).json({ faqs, total: faqs.length, page: 1 });
    }

    const result = await listPublishedFaqs({
      category,
      limit: req.query.limit,
      page: req.query.page,
    });
    res.status(200).json(result);
  } catch (error) {
    console.error('Get help FAQs error:', error);
    res.status(500).json({ error: 'Unable to load help articles.' });
  }
};

export const searchHelp = async (req, res) => {
  try {
    const query = typeof req.query.q === 'string' ? req.query.q : req.query.search || '';
    const faqs = await searchPublishedFaqs(query, {
      category: req.query.category,
      limit: req.query.limit || 5,
    });
    res.status(200).json({ faqs, query: String(query).trim() });
  } catch (error) {
    console.error('Search help error:', error);
    res.status(500).json({ error: 'Unable to search help articles.' });
  }
};

export const getHelpFaqById = async (req, res) => {
  try {
    const faq = await getPublishedFaqById(req.params.id);
    if (!faq) {
      return res.status(404).json({ error: 'FAQ not found.' });
    }
    res.status(200).json(faq);
  } catch (error) {
    console.error('Get help FAQ error:', error);
    res.status(500).json({ error: 'Unable to load this help article.' });
  }
};

export const postFaqFeedback = async (req, res) => {
  try {
    const helpful = req.body?.helpful;
    const feedback = await submitFaqFeedback(req.params.id, req.user.userId, helpful);
    res.status(200).json({ message: 'Thank you for your feedback.', feedback });
  } catch (error) {
    if (error.status) {
      return res.status(error.status).json({ error: error.message });
    }
    console.error('FAQ feedback error:', error);
    res.status(500).json({ error: 'Unable to save your feedback.' });
  }
};
