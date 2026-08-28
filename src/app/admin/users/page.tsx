"use client";

/** Admin: users, roles, and account status. Role changes require a reason. */
import { useCallback, useEffect, useState } from "react";
import { Badge, Msg } from "../../components";
import { api, errText, fmtDateTime, type UserRec } from "../../lib";

type Role = "user" | "admin" | "investigator";
const ROLES: Role[] = ["user", "admin", "investigator"];

interface UserEdit {
  role: Role;
  active: boolean;
  reason: string;
}

export default function AdminUsersPage() {
  const [users, setUsers] = useState<UserRec[]>([]);
  const [edits, setEdits] = useState<Record<string, UserEdit>>({});
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [saving, setSaving] = useState("");

  const [newEmail, setNewEmail] = useState("");
  const [newName, setNewName] = useState("");
  const [newRole, setNewRole] = useState<Role>("user");
  const [newReason, setNewReason] = useState("");

  const load = useCallback(async () => {
    try {
      const d = await api<{ users: UserRec[] }>("/api/admin/users");
      setUsers(d.users);
      setEdits(
        Object.fromEntries(
          d.users.map((u) => [u.id, { role: u.role, active: u.active, reason: "" }]),
        ),
      );
      setError("");
    } catch (err) {
      setError(errText(err));
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const saveUser = useCallback(
    async (u: UserRec) => {
      const edit = edits[u.id];
      if (!edit) return;
      const roleChanged = edit.role !== u.role;
      if (roleChanged && !edit.reason.trim()) {
        setError(`A reason is required to change the role for ${u.email}.`);
        return;
      }
      setSaving(u.id);
      setError("");
      setNotice("");
      try {
        await api("/api/admin/users", {
          method: "POST",
          body: JSON.stringify({
            email: u.email,
            role: edit.role,
            active: edit.active,
            reason: edit.reason.trim() || undefined,
          }),
        });
        setNotice(`${u.email} saved.`);
        await load();
      } catch (err) {
        setError(errText(err));
      } finally {
        setSaving("");
      }
    },
    [edits, load],
  );

  const addUser = useCallback(async () => {
    setSaving("new");
    setError("");
    setNotice("");
    try {
      await api("/api/admin/users", {
        method: "POST",
        body: JSON.stringify({
          email: newEmail.trim(),
          name: newName.trim() || undefined,
          role: newRole,
          reason: newReason.trim() || undefined,
        }),
      });
      setNotice(`${newEmail} added.`);
      setNewEmail("");
      setNewName("");
      setNewRole("user");
      setNewReason("");
      await load();
    } catch (err) {
      setError(errText(err));
    } finally {
      setSaving("");
    }
  }, [newEmail, newName, newRole, newReason, load]);

  return (
    <div>
      <h1>Users &amp; roles</h1>
      <p className="page-sub">
        Roles are enforced server-side on every API call. Role changes require a reason.
      </p>

      <Msg kind="error">{error}</Msg>
      <Msg kind="success">{notice}</Msg>

      <div className="card">
        <h2>Add user</h2>
        <div className="field-row">
          <div className="field">
            <label htmlFor="nu-email">Email</label>
            <input id="nu-email" type="email" value={newEmail} onChange={(e) => setNewEmail(e.target.value)} />
          </div>
          <div className="field">
            <label htmlFor="nu-name">Name</label>
            <input id="nu-name" type="text" value={newName} onChange={(e) => setNewName(e.target.value)} />
          </div>
          <div className="field">
            <label htmlFor="nu-role">Role</label>
            <select id="nu-role" value={newRole} onChange={(e) => setNewRole(e.target.value as Role)}>
              {ROLES.map((r) => (
                <option key={r} value={r}>
                  {r}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label htmlFor="nu-reason">Reason</label>
            <input id="nu-reason" type="text" value={newReason} onChange={(e) => setNewReason(e.target.value)} />
          </div>
        </div>
        <button
          type="button"
          className="btn-primary"
          disabled={!newEmail.trim() || saving === "new"}
          onClick={() => void addUser()}
        >
          {saving === "new" ? "Adding…" : "Add user"}
        </button>
      </div>

      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Email</th>
              <th>Name</th>
              <th>Role</th>
              <th>Active</th>
              <th>Reason (required for role change)</th>
              <th>Created</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {users.map((u) => {
              const edit = edits[u.id] ?? { role: u.role, active: u.active, reason: "" };
              const roleChanged = edit.role !== u.role;
              return (
                <tr key={u.id}>
                  <td className="mono small">{u.email}</td>
                  <td>{u.name}</td>
                  <td>
                    <select
                      aria-label={`Role for ${u.email}`}
                      value={edit.role}
                      onChange={(e) =>
                        setEdits((cur) => ({ ...cur, [u.id]: { ...edit, role: e.target.value as Role } }))
                      }
                    >
                      {ROLES.map((r) => (
                        <option key={r} value={r}>
                          {r}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td>
                    <label className="checkbox-label" style={{ margin: 0 }}>
                      <input
                        type="checkbox"
                        aria-label={`Active for ${u.email}`}
                        checked={edit.active}
                        onChange={(e) =>
                          setEdits((cur) => ({ ...cur, [u.id]: { ...edit, active: e.target.checked } }))
                        }
                      />
                      <Badge value={edit.active ? "active" : "inactive"} />
                    </label>
                  </td>
                  <td>
                    <input
                      type="text"
                      aria-label={`Reason for changes to ${u.email}`}
                      value={edit.reason}
                      placeholder={roleChanged ? "Required — role is changing" : "Optional"}
                      onChange={(e) =>
                        setEdits((cur) => ({ ...cur, [u.id]: { ...edit, reason: e.target.value } }))
                      }
                    />
                  </td>
                  <td className="nowrap small">{fmtDateTime(u.createdAt)}</td>
                  <td>
                    <button
                      type="button"
                      className="btn-small"
                      disabled={saving === u.id || (roleChanged && !edit.reason.trim())}
                      onClick={() => void saveUser(u)}
                    >
                      {saving === u.id ? "Saving…" : "Save"}
                    </button>
                  </td>
                </tr>
              );
            })}
            {users.length === 0 ? (
              <tr>
                <td colSpan={7} className="muted">
                  No users loaded (admin role required).
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </div>
  );
}
