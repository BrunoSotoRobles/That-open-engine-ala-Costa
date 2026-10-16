import React from "react";
import { addDocument, updateDocument, deleteDocument } from "../firebase";
import { isUserProtected, getProtectionMessage } from "../config/protectedData";

interface User {
  id?: string;
  name: string;
  email: string;
  role: string;
  department: string;
  status: 'active' | 'inactive';
  joinDate: string;
  avatar?: string;
}

export function UsersPage() {
  const [users, setUsers] = React.useState<User[]>([
    {
      id: '1',
      name: "John Doe",
      email: "john.doe@bsoto.com",
      role: "Senior Engineer",
      department: "Structural Engineering",
      status: 'active',
      joinDate: "2023-01-15",
      avatar: "JD"
    },
    {
      id: '2',
      name: "Jane Smith",
      email: "jane.smith@bsoto.com",
      role: "Project Manager",
      department: "Project Management",
      status: 'active',
      joinDate: "2022-08-20",
      avatar: "JS"
    },
    {
      id: '3',
      name: "Antonio Rodriguez",
      email: "antonio.rodriguez@bsoto.com",
      role: "BIM Specialist",
      department: "BIM Development",
      status: 'active',
      joinDate: "2023-03-10",
      avatar: "AR"
    },
    {
      id: '4',
      name: "Juan Carlos",
      email: "juan.carlos@bsoto.com",
      role: "Civil Engineer",
      department: "Civil Engineering",
      status: 'inactive',
      joinDate: "2022-11-05",
      avatar: "JC"
    },
    {
      id: '5',
      name: "Vishwajeet Kumar",
      email: "vishwajeet.kumar@bsoto.com",
      role: "Software Developer",
      department: "Software Development",
      status: 'active',
      joinDate: "2023-06-12",
      avatar: "VK"
    }
  ]);

  const [searchTerm, setSearchTerm] = React.useState("");
  const [showAddUser, setShowAddUser] = React.useState(false);
  const [editingUser, setEditingUser] = React.useState<User | null>(null);
  const [filterStatus, setFilterStatus] = React.useState<'all' | 'active' | 'inactive'>('all');

  // Filter users based on search term and status
  const filteredUsers = users.filter(user => {
    const matchesSearch = user.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
                         user.email.toLowerCase().includes(searchTerm.toLowerCase()) ||
                         user.role.toLowerCase().includes(searchTerm.toLowerCase()) ||
                         user.department.toLowerCase().includes(searchTerm.toLowerCase());
    
    const matchesStatus = filterStatus === 'all' || user.status === filterStatus;
    
    return matchesSearch && matchesStatus;
  });

  const handleAddUser = async (userData: Omit<User, 'id'>) => {
    try {
      const newId = await addDocument('users', userData);
      const newUser = { ...userData, id: newId };
      setUsers(prev => [...prev, newUser]);
      setShowAddUser(false);
    } catch (error) {
      console.error('Error adding user:', error);
      alert('Error adding user. Please try again.');
    }
  };

  const handleUpdateUser = async (id: string, userData: Partial<User>) => {
    try {
      await updateDocument('users', id, userData);
      setUsers(prev => prev.map(user => 
        user.id === id ? { ...user, ...userData } : user
      ));
      setEditingUser(null);
    } catch (error) {
      console.error('Error updating user:', error);
      alert('Error updating user. Please try again.');
    }
  };

  const handleDeleteUser = async (id: string) => {
    // Verificar si es un usuario protegido
    if (isUserProtected(id)) {
      alert(getProtectionMessage('user'));
      return;
    }

    if (window.confirm('Are you sure you want to delete this user?')) {
      try {
        await deleteDocument('users', id);
        setUsers(prev => prev.filter(user => user.id !== id));
      } catch (error) {
        console.error('Error deleting user:', error);
        alert('Error deleting user. Please try again.');
      }
    }
  };

  const onNewUserClicked = () => {
    setShowAddUser(true);
  };

  const onFormSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const form = e.target as HTMLFormElement;
    const formData = new FormData(form);
    
    const userData: Omit<User, 'id'> = {
      name: formData.get("name") as string,
      email: formData.get("email") as string,
      role: formData.get("role") as string,
      department: formData.get("department") as string,
      status: formData.get("status") as 'active' | 'inactive',
      joinDate: formData.get("joinDate") as string,
      avatar: (formData.get("name") as string).substring(0, 2).toUpperCase()
    };

    try {
      await handleAddUser(userData);
      form.reset();
      setShowAddUser(false);
    } catch (error) {
      console.error("Error creating user:", error);
      alert("Error creating user. Please check the input.");
    }
  };

  const onEditFormSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const form = e.target as HTMLFormElement;
    const formData = new FormData(form);
    
    if (!editingUser?.id) return;

    const userData: Partial<User> = {
      name: formData.get("name") as string,
      email: formData.get("email") as string,
      role: formData.get("role") as string,
      department: formData.get("department") as string,
      status: formData.get("status") as 'active' | 'inactive',
      joinDate: formData.get("joinDate") as string
    };

    try {
      await handleUpdateUser(editingUser.id, userData);
      form.reset();
      setEditingUser(null);
    } catch (error) {
      console.error("Error updating user:", error);
      alert("Error updating user. Please check the input.");
    }
  };

  // Modal management with useEffect
  React.useEffect(() => {
    if (showAddUser) {
      const modal = document.getElementById("new-user-modal") as HTMLDialogElement;
      if (modal) {
        modal.showModal();
        const handleClose = () => setShowAddUser(false);
        modal.addEventListener('close', handleClose);
        return () => modal.removeEventListener('close', handleClose);
      }
    }
  }, [showAddUser]);

  React.useEffect(() => {
    if (editingUser) {
      const modal = document.getElementById("edit-user-modal") as HTMLDialogElement;
      if (modal) {
        modal.showModal();
        const handleClose = () => setEditingUser(null);
        modal.addEventListener('close', handleClose);
        return () => modal.removeEventListener('close', handleClose);
      }
    }
  }, [editingUser]);
  
  return (
    <div className="page" id="users-page" style={{ display: "flex" }}>
      {/* Add User Modal */}
      <dialog id="new-user-modal">
        <form
          onSubmit={onFormSubmit}
          id="new-user-form"
          style={{
            maxHeight: "400px",
            overflowY: "auto",
          }}
        >
          <h2>Add New User</h2>
          <div className="input-list">
            <div className="form-field-container">
              <label>
                <span className="material-icons-round">person</span>Name
              </label>
              <input
                name="name"
                type="text"
                required
                placeholder="Enter user's full name"
              />
            </div>
            <div className="form-field-container">
              <label>
                <span className="material-icons-round">email</span>Email
              </label>
              <input
                name="email"
                type="email"
                required
                placeholder="user@bsoto.com"
              />
            </div>
            <div className="form-field-container">
              <label>
                <span className="material-icons-round">work</span>Role
              </label>
              <input
                name="role"
                type="text"
                required
                placeholder="e.g., Senior Engineer"
              />
            </div>
            <div className="form-field-container">
              <label>
                <span className="material-icons-round">business</span>Department
              </label>
              <input
                name="department"
                type="text"
                required
                placeholder="e.g., Structural Engineering"
              />
            </div>
            <div className="form-field-container">
              <label>
                <span className="material-icons-round">toggle_on</span>Status
              </label>
              <select name="status" required>
                <option value="active">Active</option>
                <option value="inactive">Inactive</option>
              </select>
            </div>
            <div className="form-field-container">
              <label>
                <span className="material-icons-round">calendar_month</span>Join Date
              </label>
              <input
                name="joinDate"
                type="date"
                required
                defaultValue={new Date().toISOString().split('T')[0]}
              />
            </div>
            <div
              style={{
                display: "flex",
                margin: "10px 0px 10px auto",
                columnGap: 10,
              }}
            >
              <button 
                type="button" 
                onClick={() => setShowAddUser(false)}
                style={{ backgroundColor: "transparent" }}
              >
                Cancel
              </button>
              <button
                type="submit"
                style={{ backgroundColor: "rgb(18, 145, 18)" }}
              >
                Add User
              </button>
            </div>
          </div>
        </form>
      </dialog>

      {/* Edit User Modal */}
      <dialog id="edit-user-modal">
        <form
          onSubmit={onEditFormSubmit}
          id="edit-user-form"
          style={{
            maxHeight: "400px",
            overflowY: "auto",
          }}
        >
          <h2>Edit User</h2>
          <div className="input-list">
            <div className="form-field-container">
              <label>
                <span className="material-icons-round">person</span>Name
              </label>
              <input
                name="name"
                type="text"
                required
                defaultValue={editingUser?.name || ''}
              />
            </div>
            <div className="form-field-container">
              <label>
                <span className="material-icons-round">email</span>Email
              </label>
              <input
                name="email"
                type="email"
                required
                defaultValue={editingUser?.email || ''}
              />
            </div>
            <div className="form-field-container">
              <label>
                <span className="material-icons-round">work</span>Role
              </label>
              <input
                name="role"
                type="text"
                required
                defaultValue={editingUser?.role || ''}
              />
            </div>
            <div className="form-field-container">
              <label>
                <span className="material-icons-round">business</span>Department
              </label>
              <input
                name="department"
                type="text"
                required
                defaultValue={editingUser?.department || ''}
              />
            </div>
            <div className="form-field-container">
              <label>
                <span className="material-icons-round">toggle_on</span>Status
              </label>
              <select name="status" required defaultValue={editingUser?.status || 'active'}>
                <option value="active">Active</option>
                <option value="inactive">Inactive</option>
              </select>
            </div>
            <div className="form-field-container">
              <label>
                <span className="material-icons-round">calendar_month</span>Join Date
              </label>
              <input
                name="joinDate"
                type="date"
                required
                defaultValue={editingUser?.joinDate || ''}
              />
            </div>
            <div
              style={{
                display: "flex",
                margin: "10px 0px 10px auto",
                columnGap: 10,
              }}
            >
              <button 
                type="button" 
                onClick={() => setEditingUser(null)}
                style={{ backgroundColor: "transparent" }}
              >
                Cancel
              </button>
              <button
                type="submit"
                style={{ backgroundColor: "rgb(18, 145, 18)" }}
              >
                Update User
              </button>
            </div>
          </div>
        </form>
      </dialog>

      <header>
        <h2 style={{ 
          display: 'flex', 
          alignItems: 'center', 
          gap: '8px',
          margin: 0,
          fontSize: '1.5rem'
        }}>
          <span className="material-icons-round">people</span>
          Users
        </h2>
        <div style={{ display: 'flex', gap: '1rem', alignItems: 'center' }}>
          <button
            onClick={onNewUserClicked}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
              padding: '8px 16px',
              backgroundColor: 'var(--primary)',
              color: 'white',
              border: 'none',
              borderRadius: '6px',
              cursor: 'pointer',
              fontSize: '14px'
            }}
          >
            <span className="material-icons-round" style={{ fontSize: '18px' }}>add</span>
            Add User
          </button>
        </div>
      </header>

      <div className="main-page-content" style={{ padding: '2rem' }}>
        {/* Search and Filter Controls */}
        <div style={{ 
          display: 'flex', 
          gap: '1rem', 
          marginBottom: '2rem',
          flexWrap: 'wrap',
          alignItems: 'center',
          justifyContent: 'space-between'
        }}>
          <div style={{ position: 'relative', flex: '0 1 400px', minWidth: '300px' }}>
            <span className="material-icons-round" style={{
              position: 'absolute',
              left: '12px',
              top: '50%',
              transform: 'translateY(-50%)',
              color: 'var(--text-2)',
              fontSize: '20px'
            }}>
              search
            </span>
            <input
              type="text"
              placeholder="Search users..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              style={{
                width: '100%',
                padding: '12px 12px 12px 44px',
                border: '1px solid var(--border)',
                borderRadius: '8px',
                backgroundColor: 'var(--surface-1)',
                color: 'var(--text-1)',
                fontSize: '14px'
              }}
            />
          </div>
          
          <select
            value={filterStatus}
            onChange={(e) => setFilterStatus(e.target.value as any)}
            style={{
              padding: '12px 16px',
              border: '1px solid var(--border)',
              borderRadius: '8px',
              backgroundColor: 'var(--surface-1)',
              color: 'var(--text-1)',
              fontSize: '14px',
              cursor: 'pointer',
              minWidth: '140px',
              flex: '0 0 auto'
            }}
          >
            <option value="all">All Status</option>
            <option value="active">Active</option>
            <option value="inactive">Inactive</option>
          </select>
        </div>

        {/* Users Grid */}
        <div id="users-list" style={{
          display: 'grid',
          padding: '20px 40px',
          gap: '30px',
          gridTemplateColumns: 'repeat(auto-fill, minmax(350px, 1fr))'
        }}>
          {filteredUsers.map(user => (
            <div key={user.id} className="user-card" style={{
              backgroundColor: 'var(--background-100)',
              borderRadius: '8px',
              cursor: 'pointer',
              transition: 'all 0.2s ease'
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.outline = '2px solid var(--primary)';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.outline = 'none';
            }}
            >
              <div className="card-header">
                <div style={{
                  fontSize: 20,
                  backgroundColor: "#ca8134",
                  color: "#fff",
                  aspectRatio: 1,
                  borderRadius: "100%",
                  padding: 12,
                  margin: 0,
                  textAlign: "center",
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  minWidth: '44px',
                  minHeight: '44px'
                }}>
                  {user.avatar}
                </div>
                <div style={{ flex: 1, overflow: "hidden", minWidth: 0 }}>
                  <div style={{
                    fontSize: "16px",
                    color: "#fff",
                    fontWeight: "bold",
                    wordBreak: "break-word",
                    overflowWrap: "break-word",
                    maxWidth: "100%",
                    display: "block",
                    marginBottom: '4px'
                  }}>
                    {user.name}
                  </div>
                  <div style={{
                    color: "#fff",
                    wordBreak: "break-word",
                    overflowWrap: "break-word",
                    maxWidth: "100%",
                    display: "block",
                    whiteSpace: "normal",
                    fontSize: '14px'
                  }}>
                    {user.email}
                  </div>
                </div>
                <div style={{
                  padding: '4px 12px',
                  borderRadius: '20px',
                  fontSize: '12px',
                  fontWeight: '500',
                  backgroundColor: user.status === 'active' ? 'rgba(76, 175, 80, 0.2)' : 'rgba(244, 67, 54, 0.2)',
                  color: user.status === 'active' ? '#4CAF50' : '#F44336',
                  border: user.status === 'active' ? '1px solid rgba(76, 175, 80, 0.3)' : '1px solid rgba(244, 67, 54, 0.3)'
                }}>
                  {user.status}
                </div>
              </div>
              <div className="card-content">
                <div className="card-property">
                  <div>Role</div>
                  <div style={{ color: "#fff" }}>
                    {user.role}
                  </div>
                </div>
                <div className="card-property">
                  <div>Department</div>
                  <div style={{ color: "#fff" }}>
                    {user.department}
                  </div>
                </div>
                <div className="card-property">
                  <div>Join Date</div>
                  <div style={{ color: "#fff" }}>
                    {new Date(user.joinDate).toLocaleDateString()}
                  </div>
                </div>
                <div className="card-property">
                  <div>Actions</div>
                  <div style={{ 
                    display: 'flex', 
                    gap: '0.5rem',
                    color: "#fff" 
                  }}>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        setEditingUser(user);
                      }}
                      style={{
                        padding: '4px 8px',
                        backgroundColor: 'transparent',
                        color: 'var(--primary)',
                        border: '1px solid var(--primary)',
                        borderRadius: '4px',
                        cursor: 'pointer',
                        fontSize: '11px',
                        display: 'flex',
                        alignItems: 'center',
                        gap: '2px'
                      }}
                    >
                      <span className="material-icons-round" style={{ fontSize: '14px' }}>edit</span>
                      Edit
                    </button>
                    {!isUserProtected(user.id!) && (
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          handleDeleteUser(user.id!);
                        }}
                        style={{
                          padding: '4px 8px',
                          backgroundColor: 'transparent',
                          color: '#F44336',
                          border: '1px solid #F44336',
                          borderRadius: '4px',
                          cursor: 'pointer',
                          fontSize: '11px',
                          display: 'flex',
                          alignItems: 'center',
                          gap: '2px'
                        }}
                      >
                        <span className="material-icons-round" style={{ fontSize: '14px' }}>delete</span>
                        Delete
                      </button>
                    )}
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>

        {filteredUsers.length === 0 && (
          <div style={{
            textAlign: 'center',
            padding: '3rem',
            color: 'var(--text-2)'
          }}>
            <span className="material-icons-round" style={{ fontSize: '48px', marginBottom: '1rem' }}>
              search_off
            </span>
            <p>No users found matching your search criteria.</p>
          </div>
        )}
      </div>
    </div>
  );
}