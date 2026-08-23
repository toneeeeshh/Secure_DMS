// Five-role model for the SIH demo.
const ROLES = ['admin', 'police_officer', 'investigator', 'forensic_expert', 'legal_officer'];

const ROLE_LABELS = {
  admin: 'Administrator',
  police_officer: 'Police Officer',
  investigator: 'Investigator',
  forensic_expert: 'Forensic Expert',
  legal_officer: 'Legal / Prosecution Officer'
};

const CAN_CREATE_CASE = ['admin', 'police_officer', 'investigator'];
const CAN_UPLOAD_DOCS = ['admin', 'police_officer', 'investigator', 'forensic_expert'];
const CAN_MANAGE_USERS = ['admin'];
const CAN_ARCHIVE = ['admin'];

function canAccessCase(user, kase) {
  if (!kase) return false;
  if (user.role === 'admin') return true;
  if (kase.createdBy === user.username) return true;
  return Array.isArray(kase.members) && kase.members.includes(user.username);
}

function canManageCaseMembers(user, kase) {
  return user.role === 'admin' || kase.createdBy === user.username;
}

function canUploadToCase(user, kase) {
  return CAN_UPLOAD_DOCS.includes(user.role) && canAccessCase(user, kase);
}

module.exports = {
  ROLES, ROLE_LABELS,
  CAN_CREATE_CASE, CAN_UPLOAD_DOCS, CAN_MANAGE_USERS, CAN_ARCHIVE,
  canAccessCase, canManageCaseMembers, canUploadToCase
};
