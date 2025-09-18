#!/usr/bin/env node
// users-cli.mjs — standalone admin CLI for managing data/userLogins.json
// Run from repo root. Requires: npm i bcryptjs

import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import bcrypt from 'bcryptjs';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);

// Default to repo-root/data/userLogins.json (when run from root)
const DEFAULT_USERS_PATH = path.resolve(process.cwd(), 'data', 'userLogins.json');

// Allow overriding with --file <path>
function parseFlags(argv) {
  const flags = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--file') { flags.file = argv[++i]; continue; }
    if (a === '--role') { flags.role = argv[++i]; continue; }
    if (a === '--inactive') { flags.inactive = true; continue; }
  }
  return flags;
}

function getUsersPath(flags) {
  if (flags.file) return path.resolve(process.cwd(), flags.file);
  return DEFAULT_USERS_PATH;
}

function readUsers(usersPath) {
  if (!fs.existsSync(usersPath)) return [];
  const txt = fs.readFileSync(usersPath, 'utf8').trim() || '[]';
  const data = JSON.parse(txt);
  if (!Array.isArray(data)) throw new Error(`${usersPath} must be a JSON array`);
  return data;
}

function writeUsers(usersPath, users) {
  fs.mkdirSync(path.dirname(usersPath), { recursive: true });
  const tmp = usersPath + '.' + crypto.randomBytes(6).toString('hex') + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(users, null, 2) + '\n', 'utf8');
  fs.renameSync(tmp, usersPath);
}

function nowISO() { return new Date().toISOString(); }

function findUser(users, userId) {
  return users.find(u => String(u.userId).toLowerCase() === String(userId).toLowerCase());
}

function ensureUnique(users, userId) {
  if (findUser(users, userId)) throw new Error(`User "${userId}" already exists.`);
}

/* ------------------------------- Commands -------------------------------- */
function addUser(usersPath, { userId, password, role = 'staff', active = true }) {
  const users = readUsers(usersPath);
  ensureUnique(users, userId);
  users.push({
    userId,
    passwordHash: bcrypt.hashSync(password, 10),
    role,
    active,
    createdAt: nowISO(),
    updatedAt: nowISO(),
  });
  writeUsers(usersPath, users);
  console.log(`✅ Added "${userId}" (role=${role}, active=${active})`);
}

function setPassword(usersPath, { userId, password }) {
  const users = readUsers(usersPath);
  const u = findUser(users, userId);
  if (!u) throw new Error(`User "${userId}" not found.`);
  u.passwordHash = bcrypt.hashSync(password, 10);
  u.updatedAt = nowISO();
  writeUsers(usersPath, users);
  console.log(`🔑 Updated password for "${userId}"`);
}

function setActive(usersPath, { userId, active }) {
  const users = readUsers(usersPath);
  const u = findUser(users, userId);
  if (!u) throw new Error(`User "${userId}" not found.`);
  u.active = !!active;
  u.updatedAt = nowISO();
  writeUsers(usersPath, users);
  console.log(`${active ? '✅ Activated' : '🚫 Deactivated'} "${userId}"`);
}

function setRole(usersPath, { userId, role }) {
  const users = readUsers(usersPath);
  const u = findUser(users, userId);
  if (!u) throw new Error(`User "${userId}" not found.`);
  u.role = role;
  u.updatedAt = nowISO();
  writeUsers(usersPath, users);
  console.log(`🛡️  Set role for "${userId}" to "${role}"`);
}

function listUsers(usersPath) {
  const users = readUsers(usersPath);
  if (!users.length) return console.log('No users.');
  for (const u of users) {
    const act = u.active !== false;
    console.log(`${u.userId}  role=${u.role ?? 'staff'}  active=${act}  createdAt=${u.createdAt ?? ''}`);
  }
}

function testLogin(usersPath, { userId, password }) {
  const users = readUsers(usersPath);
  const u = findUser(users, userId);
  if (!u) return console.log('❌ No such user.');
  const ok = bcrypt.compareSync(password, u.passwordHash);
  console.log(ok ? '✅ Password OK' : '❌ Invalid password');
}

function help() {
  console.log(`
Users CLI (standalone)

Usage:
  node users-cli.mjs <command> [args] [--file data/userLogins.json]

Commands:
  add <userId> <password> [--role admin|staff] [--inactive]
  passwd <userId> <newPassword>
  role <userId> <role>
  deactivate <userId>
  activate <userId>
  list
  test <userId> <password>

Examples:
  node users-cli.mjs add darian "MyNewSecurePwd!123" --role admin
  node users-cli.mjs passwd ariana "Another$trongPwd"
  node users-cli.mjs deactivate contractor1
  node users-cli.mjs activate contractor1
  node users-cli.mjs role ariana staff
  node users-cli.mjs list
  node users-cli.mjs test darian "MyNewSecurePwd!123"

Options:
  --file <path>    Use a custom JSON path (default: data/userLogins.json)
`);
}

/* --------------------------------- Main ---------------------------------- */
function main() {
  const [, , cmd, ...rest] = process.argv;
  const flags = parseFlags(rest);
  const usersPath = getUsersPath(flags);

  try {
    switch (cmd) {
      case 'add': {
        const [userId, password] = rest.filter(a => !a.startsWith('--'));
        if (!userId || !password) return help();
        addUser(usersPath, { userId, password, role: flags.role || 'staff', active: !flags.inactive });
        break;
      }
      case 'passwd': {
        const [userId, password] = rest.filter(a => !a.startsWith('--'));
        if (!userId || !password) return help();
        setPassword(usersPath, { userId, password });
        break;
      }
      case 'role': {
        const [userId, role] = rest.filter(a => !a.startsWith('--'));
        if (!userId || !role) return help();
        setRole(usersPath, { userId, role });
        break;
      }
      case 'deactivate': {
        const [userId] = rest.filter(a => !a.startsWith('--'));
        if (!userId) return help();
        setActive(usersPath, { userId, active: false });
        break;
      }
      case 'activate': {
        const [userId] = rest.filter(a => !a.startsWith('--'));
        if (!userId) return help();
        setActive(usersPath, { userId, active: true });
        break;
      }
      case 'list': {
        listUsers(usersPath); break;
      }
      case 'test': {
        const [userId, password] = rest.filter(a => !a.startsWith('--'));
        if (!userId || !password) return help();
        testLogin(usersPath, { userId, password });
        break;
      }
      default:
        help();
    }
  } catch (e) {
    console.error('Error:', e.message);
    process.exitCode = 1;
  }
}

main();
