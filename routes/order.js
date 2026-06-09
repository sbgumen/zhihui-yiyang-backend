const express = require('express')
const pool = require('../config/db')
const { authMiddleware } = require('../middleware/auth')

const router = express.Router()

// 创建订单（结算）
router.post('/create', authMiddleware, async (req, res) => {
  try {
    const { items, totalPrice } = req.body

    if (!items || !Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ code: 400, message: '订单不能为空' })
    }
    if (!totalPrice || totalPrice <= 0) {
      return res.status(400).json({ code: 400, message: '订单金额无效' })
    }

    // 检查余额
    const [users] = await pool.execute('SELECT balance FROM users WHERE id = ?', [req.user.id])
    if (users.length === 0) {
      return res.status(404).json({ code: 404, message: '用户不存在' })
    }

    const balance = parseFloat(users[0].balance)
    if (balance < totalPrice) {
      return res.status(400).json({ code: 400, message: '余额不足，请先充值', data: { balance } })
    }

    // 扣除余额
    await pool.execute('UPDATE users SET balance = balance - ? WHERE id = ?', [totalPrice, req.user.id])

    // 创建订单
    const orderNo = 'ORD' + Date.now() + Math.random().toString(36).substr(2, 4).toUpperCase()
    const itemsJson = JSON.stringify(items)

    await pool.execute(
      'INSERT INTO orders (order_no, user_id, items, total_price, status) VALUES (?, ?, ?, ?, ?)',
      [orderNo, req.user.id, itemsJson, totalPrice, 'pending']
    )

    // 返回新余额
    const [updatedUsers] = await pool.execute('SELECT balance FROM users WHERE id = ?', [req.user.id])
    const newBalance = parseFloat(updatedUsers[0].balance)

    res.json({
      code: 200,
      message: '下单成功',
      data: { orderNo, balance: newBalance }
    })
  } catch (err) {
    console.error('创建订单失败:', err)
    res.status(500).json({ code: 500, message: '服务器错误' })
  }
})

// 获取订单列表
router.get('/list', authMiddleware, async (req, res) => {
  try {
    const [orders] = await pool.execute(
      'SELECT * FROM orders WHERE user_id = ? ORDER BY created_at DESC',
      [req.user.id]
    )

    const parsed = orders.map(o => ({
      ...o,
      items: JSON.parse(o.items),
      total_price: parseFloat(o.total_price)
    }))

    res.json({ code: 200, data: parsed })
  } catch (err) {
    console.error('获取订单列表失败:', err)
    res.status(500).json({ code: 500, message: '服务器错误' })
  }
})

// 取消订单（退款）
router.post('/cancel', authMiddleware, async (req, res) => {
  try {
    const { orderNo } = req.body
    if (!orderNo) {
      return res.status(400).json({ code: 400, message: '订单号不能为空' })
    }

    const [orders] = await pool.execute(
      'SELECT * FROM orders WHERE order_no = ? AND user_id = ?',
      [orderNo, req.user.id]
    )

    if (orders.length === 0) {
      return res.status(404).json({ code: 404, message: '订单不存在' })
    }

    if (orders[0].status !== 'pending') {
      return res.status(400).json({ code: 400, message: '该订单无法取消' })
    }

    const refund = parseFloat(orders[0].total_price)

    // 退款
    await pool.execute('UPDATE users SET balance = balance + ? WHERE id = ?', [refund, req.user.id])
    // 更新订单状态
    await pool.execute('UPDATE orders SET status = ? WHERE order_no = ?', ['cancelled', orderNo])

    const [users] = await pool.execute('SELECT balance FROM users WHERE id = ?', [req.user.id])
    const newBalance = parseFloat(users[0].balance)

    res.json({ code: 200, message: '订单已取消，已退款', data: { balance: newBalance } })
  } catch (err) {
    console.error('取消订单失败:', err)
    res.status(500).json({ code: 500, message: '服务器错误' })
  }
})

// 确认订单
router.post('/confirm', authMiddleware, async (req, res) => {
  try {
    const { orderNo } = req.body
    if (!orderNo) {
      return res.status(400).json({ code: 400, message: '订单号不能为空' })
    }

    const [orders] = await pool.execute(
      'SELECT * FROM orders WHERE order_no = ? AND user_id = ?',
      [orderNo, req.user.id]
    )

    if (orders.length === 0) {
      return res.status(404).json({ code: 404, message: '订单不存在' })
    }

    if (orders[0].status !== 'pending') {
      return res.status(400).json({ code: 400, message: '该订单无法确认' })
    }

    await pool.execute('UPDATE orders SET status = ? WHERE order_no = ?', ['confirmed', orderNo])

    res.json({ code: 200, message: '订单已确认' })
  } catch (err) {
    console.error('确认订单失败:', err)
    res.status(500).json({ code: 500, message: '服务器错误' })
  }
})

module.exports = router
