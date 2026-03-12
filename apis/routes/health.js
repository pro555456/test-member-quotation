const express = require('express');

const router = express.Router();

router.get('/health', async (req, res) => {
  res.status(200).json({
    status: 'ok',
    service: 'game-qa-platform',
    now: new Date().toISOString(),
  });
});

module.exports = router;
