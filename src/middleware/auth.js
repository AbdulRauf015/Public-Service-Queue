// src/middleware/auth.js
// JWT authentication and role-based access control for staff
const jwt = require('jsonwebtoken');

const JWT_SECRET = process.env.JWT_SECRET || 'change-me';

/**
 * Sign a JWT token for a staff user (8-hour expiration)
 */
function signToken(user) {
  return jwt.sign(
    {
      id: user._id,
      email: user.email,
      name: user.name,
      role: user.role,
      branchId: user.branchId
    },
    JWT_SECRET,
    { expiresIn: '8h' }
  );
}

/**
 * Middleware: Verify JWT Bearer token
 */
function authenticate(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({
      error: { code: 'UNAUTHORIZED', message: 'Missing or invalid Authorization header' }
    });
  }

  const token = authHeader.split(' ')[1];

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    req.user = decoded;
    next();
  } catch (err) {
    return res.status(401).json({
      error: { code: 'UNAUTHORIZED', message: 'Invalid or expired token' }
    });
  }
}

/**
 * Middleware: Enforce user roles (e.g. 'operator', 'admin')
 */
function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user || !roles.includes(req.user.role)) {
      return res.status(403).json({
        error: { code: 'FORBIDDEN', message: 'Insufficient permissions for this action' }
      });
    }
    next();
  };
}

module.exports = {
  signToken,
  authenticate,
  requireRole
};
