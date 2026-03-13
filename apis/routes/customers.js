const express = require('express');

const { asyncHandler } = require('../../utils/http');
const { requireAuthAuto } = require('../../middlewares/auth');
const customerService = require('../../services/customerService');

const router = express.Router();

router.get(
  '/customers',
  requireAuthAuto,
  asyncHandler(async (req, res) => {
    const customers = await customerService.listCustomers(req.query || {});
    res.status(200).json({ customers });
  })
);

router.post(
  '/customers',
  requireAuthAuto,
  asyncHandler(async (req, res) => {
    const customer = await customerService.createCustomer(req.user, req.body || {});
    res.status(201).json({ customer });
  })
);

module.exports = router;
