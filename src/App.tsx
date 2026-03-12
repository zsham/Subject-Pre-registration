/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect } from 'react';
import { 
  GoogleAuthProvider, 
  signInWithPopup, 
  signOut, 
  onAuthStateChanged,
  User as FirebaseUser
} from 'firebase/auth';
import { 
  collection, 
  doc, 
  setDoc, 
  getDoc, 
  onSnapshot, 
  query, 
  where, 
  addDoc, 
  updateDoc, 
  deleteDoc,
  serverTimestamp,
  increment,
  getDocFromServer
} from 'firebase/firestore';
import { auth, db } from './firebase';
import { 
  BookOpen, 
  User, 
  LogOut, 
  Plus, 
  CheckCircle, 
  XCircle, 
  Clock, 
  Shield,
  GraduationCap,
  LayoutDashboard,
  ClipboardList,
  AlertCircle
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';

// --- Types ---

interface UserProfile {
  uid: string;
  email: string;
  displayName: string;
  role: 'student' | 'admin';
}

interface Subject {
  id: string;
  code: string;
  name: string;
  description: string;
  credits: number;
  capacity: number;
  registeredCount: number;
}

interface Registration {
  id: string;
  studentId: string;
  studentName: string;
  subjectId: string;
  subjectCode: string;
  subjectName: string;
  timestamp: any;
  status: 'pending' | 'approved' | 'rejected';
}

enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

// --- Components ---

const ErrorBoundary = ({ children }: { children: React.ReactNode }) => {
  const [hasError, setHasError] = useState(false);
  const [errorInfo, setErrorInfo] = useState<string | null>(null);

  useEffect(() => {
    const handleError = (event: ErrorEvent) => {
      if (event.error?.message && event.error.message.startsWith('{')) {
        setHasError(true);
        setErrorInfo(event.error.message);
      }
    };
    window.addEventListener('error', handleError);
    return () => window.removeEventListener('error', handleError);
  }, []);

  if (hasError) {
    const info = JSON.parse(errorInfo || '{}');
    return (
      <div className="min-h-screen flex items-center justify-center bg-red-50 p-4">
        <div className="max-w-md w-full bg-white rounded-2xl shadow-xl p-8 border border-red-100">
          <div className="flex items-center gap-3 text-red-600 mb-4">
            <AlertCircle size={32} />
            <h2 className="text-2xl font-bold">System Error</h2>
          </div>
          <p className="text-gray-600 mb-6">
            An error occurred while interacting with the database. This might be due to insufficient permissions.
          </p>
          <div className="bg-gray-50 rounded-lg p-4 text-xs font-mono text-gray-700 overflow-auto max-h-40">
            <pre>{JSON.stringify(info, null, 2)}</pre>
          </div>
          <button 
            onClick={() => window.location.reload()}
            className="mt-6 w-full py-3 bg-red-600 text-white rounded-xl font-semibold hover:bg-red-700 transition-colors"
          >
            Reload Application
          </button>
        </div>
      </div>
    );
  }

  return <>{children}</>;
};

export default function App() {
  const [user, setUser] = useState<FirebaseUser | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [subjects, setSubjects] = useState<Subject[]>([]);
  const [registrations, setRegistrations] = useState<Registration[]>([]);
  const [activeTab, setActiveTab] = useState<'dashboard' | 'subjects' | 'my-registrations' | 'admin-panel'>('dashboard');
  const [isAddingSubject, setIsAddingSubject] = useState(false);

  // Error handling utility
  const handleFirestoreError = (error: unknown, operationType: OperationType, path: string | null) => {
    const errInfo = {
      error: error instanceof Error ? error.message : String(error),
      authInfo: {
        userId: auth.currentUser?.uid,
        email: auth.currentUser?.email,
        emailVerified: auth.currentUser?.emailVerified,
        isAnonymous: auth.currentUser?.isAnonymous,
        tenantId: auth.currentUser?.tenantId,
        providerInfo: auth.currentUser?.providerData.map(provider => ({
          providerId: provider.providerId,
          displayName: provider.displayName,
          email: provider.email,
          photoUrl: provider.photoURL
        })) || []
      },
      operationType,
      path
    };
    console.error('Firestore Error: ', JSON.stringify(errInfo));
    throw new Error(JSON.stringify(errInfo));
  };

  // --- Auth & Profile ---

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (currentUser) => {
      setUser(currentUser);
      if (currentUser) {
        try {
          const profileDoc = await getDoc(doc(db, 'users', currentUser.uid));
          if (profileDoc.exists()) {
            setProfile(profileDoc.data() as UserProfile);
          } else {
            // Default to student role for new users
            const newProfile: UserProfile = {
              uid: currentUser.uid,
              email: currentUser.email || '',
              displayName: currentUser.displayName || 'Anonymous',
              role: 'student'
            };
            await setDoc(doc(db, 'users', currentUser.uid), newProfile);
            setProfile(newProfile);
          }
        } catch (error) {
          console.error("Error fetching profile:", error);
        }
      } else {
        setProfile(null);
      }
      setLoading(false);
    });

    // Test connection
    const testConnection = async () => {
      try {
        await getDocFromServer(doc(db, 'test', 'connection'));
      } catch (error) {
        if (error instanceof Error && error.message.includes('the client is offline')) {
          console.error("Please check your Firebase configuration.");
        }
      }
    };
    testConnection();

    return () => unsubscribe();
  }, []);

  const handleLogin = async () => {
    const provider = new GoogleAuthProvider();
    try {
      await signInWithPopup(auth, provider);
    } catch (error) {
      console.error("Login failed:", error);
    }
  };

  const handleLogout = () => signOut(auth);

  // --- Data Listeners ---

  useEffect(() => {
    if (!user || !profile) return;

    // Subjects listener
    const subjectsUnsubscribe = onSnapshot(collection(db, 'subjects'), (snapshot) => {
      const subjectsList = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Subject));
      setSubjects(subjectsList);
    }, (error) => handleFirestoreError(error, OperationType.LIST, 'subjects'));

    // Registrations listener
    let registrationsQuery;
    if (profile.role === 'admin') {
      registrationsQuery = collection(db, 'registrations');
    } else {
      registrationsQuery = query(collection(db, 'registrations'), where('studentId', '==', user.uid));
    }

    const registrationsUnsubscribe = onSnapshot(registrationsQuery, (snapshot) => {
      const regsList = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Registration));
      setRegistrations(regsList);
    }, (error) => handleFirestoreError(error, OperationType.LIST, 'registrations'));

    return () => {
      subjectsUnsubscribe();
      registrationsUnsubscribe();
    };
  }, [user, profile]);

  // --- Actions ---

  const registerForSubject = async (subject: Subject) => {
    if (!user || !profile) return;
    
    // Check if already registered
    const alreadyRegistered = registrations.some(r => r.subjectId === subject.id);
    if (alreadyRegistered) {
      alert("You are already registered for this subject.");
      return;
    }

    // Check capacity
    if (subject.registeredCount >= subject.capacity) {
      alert("This subject is full.");
      return;
    }

    try {
      await addDoc(collection(db, 'registrations'), {
        studentId: user.uid,
        studentName: profile.displayName,
        subjectId: subject.id,
        subjectCode: subject.code,
        subjectName: subject.name,
        status: 'pending',
        timestamp: serverTimestamp()
      });
      
      // Increment registered count (optimistic, but rules should handle)
      await updateDoc(doc(db, 'subjects', subject.id), {
        registeredCount: increment(1)
      });
    } catch (error) {
      handleFirestoreError(error, OperationType.CREATE, 'registrations');
    }
  };

  const updateRegistrationStatus = async (regId: string, status: 'approved' | 'rejected') => {
    try {
      await updateDoc(doc(db, 'registrations', regId), { status });
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, `registrations/${regId}`);
    }
  };

  const deleteRegistration = async (reg: Registration) => {
    try {
      await deleteDoc(doc(db, 'registrations', reg.id));
      // Decrement registered count
      await updateDoc(doc(db, 'subjects', reg.subjectId), {
        registeredCount: increment(-1)
      });
    } catch (error) {
      handleFirestoreError(error, OperationType.DELETE, `registrations/${reg.id}`);
    }
  };

  const addSubject = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);
    const newSubject = {
      code: formData.get('code') as string,
      name: formData.get('name') as string,
      description: formData.get('description') as string,
      credits: Number(formData.get('credits')),
      capacity: Number(formData.get('capacity')),
      registeredCount: 0
    };

    try {
      await addDoc(collection(db, 'subjects'), newSubject);
      setIsAddingSubject(false);
    } catch (error) {
      handleFirestoreError(error, OperationType.CREATE, 'subjects');
    }
  };

  // --- Render Helpers ---

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#F5F5F0]">
        <motion.div 
          animate={{ rotate: 360 }}
          transition={{ duration: 1, repeat: Infinity, ease: "linear" }}
          className="w-12 h-12 border-4 border-[#5A5A40] border-t-transparent rounded-full"
        />
      </div>
    );
  }

  if (!user) {
    return (
      <div className="min-h-screen bg-[#F5F5F0] flex flex-col items-center justify-center p-6 font-serif">
        <motion.div 
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="max-w-md w-full text-center space-y-8"
        >
          <div className="space-y-4">
            <div className="w-20 h-20 bg-[#5A5A40] rounded-full flex items-center justify-center mx-auto shadow-lg">
              <GraduationCap size={40} className="text-white" />
            </div>
            <h1 className="text-4xl font-bold text-[#1a1a1a]">Academic Portal</h1>
            <p className="text-[#5A5A40] italic">Subject Pre-registration System</p>
          </div>
          
          <button 
            onClick={handleLogin}
            className="w-full py-4 bg-[#5A5A40] text-white rounded-full font-sans font-medium tracking-wide shadow-md hover:bg-[#4a4a35] transition-all flex items-center justify-center gap-3"
          >
            <img src="https://www.gstatic.com/firebasejs/ui/2.0.0/images/auth/google.svg" className="w-6 h-6" alt="Google" />
            Sign in with Student ID
          </button>
          
          <p className="text-xs text-gray-500 font-sans">
            Access restricted to authorized students and faculty.
          </p>
        </motion.div>
      </div>
    );
  }

  return (
    <ErrorBoundary>
      <div className="min-h-screen bg-[#F5F5F0] font-sans text-[#1a1a1a]">
        {/* Navigation */}
        <nav className="bg-white border-b border-gray-200 sticky top-0 z-50">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
            <div className="flex justify-between h-16">
              <div className="flex items-center gap-2">
                <GraduationCap className="text-[#5A5A40]" size={28} />
                <span className="text-xl font-serif font-bold tracking-tight">Portal</span>
              </div>
              
              <div className="flex items-center gap-4">
                <div className="hidden md:flex items-center gap-2 px-3 py-1 bg-gray-100 rounded-full">
                  <User size={16} className="text-[#5A5A40]" />
                  <span className="text-sm font-medium">{profile?.displayName}</span>
                  <span className="text-[10px] uppercase tracking-widest bg-[#5A5A40] text-white px-2 py-0.5 rounded-full">
                    {profile?.role}
                  </span>
                </div>
                <button 
                  onClick={handleLogout}
                  className="p-2 text-gray-500 hover:text-red-600 transition-colors"
                  title="Logout"
                >
                  <LogOut size={20} />
                </button>
              </div>
            </div>
          </div>
        </nav>

        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
          <div className="flex flex-col md:flex-row gap-8">
            {/* Sidebar */}
            <aside className="w-full md:w-64 space-y-2">
              <button 
                onClick={() => setActiveTab('dashboard')}
                className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl transition-all ${activeTab === 'dashboard' ? 'bg-[#5A5A40] text-white shadow-md' : 'hover:bg-white text-gray-600'}`}
              >
                <LayoutDashboard size={20} />
                <span className="font-medium">Dashboard</span>
              </button>
              <button 
                onClick={() => setActiveTab('subjects')}
                className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl transition-all ${activeTab === 'subjects' ? 'bg-[#5A5A40] text-white shadow-md' : 'hover:bg-white text-gray-600'}`}
              >
                <BookOpen size={20} />
                <span className="font-medium">Subjects</span>
              </button>
              <button 
                onClick={() => setActiveTab('my-registrations')}
                className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl transition-all ${activeTab === 'my-registrations' ? 'bg-[#5A5A40] text-white shadow-md' : 'hover:bg-white text-gray-600'}`}
              >
                <ClipboardList size={20} />
                <span className="font-medium">{profile?.role === 'admin' ? 'All Registrations' : 'My Registrations'}</span>
              </button>
              {profile?.role === 'admin' && (
                <button 
                  onClick={() => setActiveTab('admin-panel')}
                  className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl transition-all ${activeTab === 'admin-panel' ? 'bg-[#5A5A40] text-white shadow-md' : 'hover:bg-white text-gray-600'}`}
                >
                  <Shield size={20} />
                  <span className="font-medium">Admin Panel</span>
                </button>
              )}
            </aside>

            {/* Main Content */}
            <main className="flex-1">
              <AnimatePresence mode="wait">
                {activeTab === 'dashboard' && (
                  <motion.div 
                    key="dashboard"
                    initial={{ opacity: 0, x: 20 }}
                    animate={{ opacity: 1, x: 0 }}
                    exit={{ opacity: 0, x: -20 }}
                    className="space-y-6"
                  >
                    <div className="bg-white rounded-3xl p-8 shadow-sm border border-gray-100">
                      <h2 className="text-3xl font-serif font-bold mb-2">Welcome back, {profile?.displayName}</h2>
                      <p className="text-gray-500 italic">Academic Year 2025/2026 • Semester 2</p>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                      <div className="bg-white p-6 rounded-2xl shadow-sm border border-gray-100">
                        <div className="flex items-center justify-between mb-4">
                          <div className="p-3 bg-blue-50 text-blue-600 rounded-xl">
                            <BookOpen size={24} />
                          </div>
                          <span className="text-2xl font-bold">{subjects.length}</span>
                        </div>
                        <h3 className="text-gray-600 font-medium">Available Subjects</h3>
                      </div>
                      <div className="bg-white p-6 rounded-2xl shadow-sm border border-gray-100">
                        <div className="flex items-center justify-between mb-4">
                          <div className="p-3 bg-green-50 text-green-600 rounded-xl">
                            <CheckCircle size={24} />
                          </div>
                          <span className="text-2xl font-bold">
                            {registrations.filter(r => r.status === 'approved').length}
                          </span>
                        </div>
                        <h3 className="text-gray-600 font-medium">Approved Courses</h3>
                      </div>
                      <div className="bg-white p-6 rounded-2xl shadow-sm border border-gray-100">
                        <div className="flex items-center justify-between mb-4">
                          <div className="p-3 bg-amber-50 text-amber-600 rounded-xl">
                            <Clock size={24} />
                          </div>
                          <span className="text-2xl font-bold">
                            {registrations.filter(r => r.status === 'pending').length}
                          </span>
                        </div>
                        <h3 className="text-gray-600 font-medium">Pending Requests</h3>
                      </div>
                    </div>
                  </motion.div>
                )}

                {activeTab === 'subjects' && (
                  <motion.div 
                    key="subjects"
                    initial={{ opacity: 0, x: 20 }}
                    animate={{ opacity: 1, x: 0 }}
                    exit={{ opacity: 0, x: -20 }}
                    className="space-y-6"
                  >
                    <div className="flex justify-between items-center">
                      <h2 className="text-2xl font-serif font-bold">Available Subjects</h2>
                      {profile?.role === 'admin' && (
                        <button 
                          onClick={() => setIsAddingSubject(true)}
                          className="flex items-center gap-2 px-4 py-2 bg-[#5A5A40] text-white rounded-full shadow-sm hover:bg-[#4a4a35] transition-all"
                        >
                          <Plus size={18} />
                          Add Subject
                        </button>
                      )}
                    </div>

                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                      {subjects.map(subject => (
                        <div key={subject.id} className="bg-white rounded-2xl p-6 shadow-sm border border-gray-100 flex flex-col justify-between">
                          <div>
                            <div className="flex justify-between items-start mb-4">
                              <div>
                                <span className="text-xs font-mono text-[#5A5A40] font-bold tracking-widest uppercase">{subject.code}</span>
                                <h3 className="text-xl font-bold mt-1">{subject.name}</h3>
                              </div>
                              <span className="px-3 py-1 bg-gray-100 rounded-full text-xs font-medium">{subject.credits} Credits</span>
                            </div>
                            <p className="text-gray-600 text-sm line-clamp-2 mb-6 italic">"{subject.description}"</p>
                          </div>
                          
                          <div className="space-y-4">
                            <div className="flex items-center justify-between text-xs text-gray-500">
                              <span>Capacity: {subject.registeredCount} / {subject.capacity}</span>
                              <div className="w-32 h-1.5 bg-gray-100 rounded-full overflow-hidden">
                                <div 
                                  className={`h-full transition-all ${subject.registeredCount >= subject.capacity ? 'bg-red-500' : 'bg-[#5A5A40]'}`}
                                  style={{ width: `${(subject.registeredCount / subject.capacity) * 100}%` }}
                                />
                              </div>
                            </div>
                            
                            {profile?.role === 'student' && (
                              <button 
                                onClick={() => registerForSubject(subject)}
                                disabled={registrations.some(r => r.subjectId === subject.id) || subject.registeredCount >= subject.capacity}
                                className={`w-full py-3 rounded-xl font-medium transition-all ${
                                  registrations.some(r => r.subjectId === subject.id)
                                    ? 'bg-gray-100 text-gray-400 cursor-not-allowed'
                                    : subject.registeredCount >= subject.capacity
                                    ? 'bg-red-50 text-red-300 cursor-not-allowed'
                                    : 'bg-[#5A5A40] text-white hover:bg-[#4a4a35] shadow-sm'
                                }`}
                              >
                                {registrations.some(r => r.subjectId === subject.id) ? 'Already Registered' : 'Register Now'}
                              </button>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  </motion.div>
                )}

                {activeTab === 'my-registrations' && (
                  <motion.div 
                    key="registrations"
                    initial={{ opacity: 0, x: 20 }}
                    animate={{ opacity: 1, x: 0 }}
                    exit={{ opacity: 0, x: -20 }}
                    className="space-y-6"
                  >
                    <h2 className="text-2xl font-serif font-bold">
                      {profile?.role === 'admin' ? 'Enrollment Management' : 'My Enrollment Status'}
                    </h2>

                    <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
                      <table className="w-full text-left border-collapse">
                        <thead>
                          <tr className="bg-gray-50 border-b border-gray-100">
                            <th className="px-6 py-4 text-xs font-bold text-gray-500 uppercase tracking-widest">Subject</th>
                            {profile?.role === 'admin' && (
                              <th className="px-6 py-4 text-xs font-bold text-gray-500 uppercase tracking-widest">Student</th>
                            )}
                            <th className="px-6 py-4 text-xs font-bold text-gray-500 uppercase tracking-widest">Status</th>
                            <th className="px-6 py-4 text-xs font-bold text-gray-500 uppercase tracking-widest text-right">Actions</th>
                          </tr>
                        </thead>
                        <tbody>
                          {registrations.length === 0 ? (
                            <tr>
                              <td colSpan={profile?.role === 'admin' ? 4 : 3} className="px-6 py-12 text-center text-gray-400 italic">
                                No registration records found.
                              </td>
                            </tr>
                          ) : (
                            registrations.map(reg => (
                              <tr key={reg.id} className="border-b border-gray-50 hover:bg-gray-50/50 transition-colors">
                                <td className="px-6 py-4">
                                  <div className="font-bold">{reg.subjectName}</div>
                                  <div className="text-xs text-gray-400 font-mono">{reg.subjectCode}</div>
                                </td>
                                {profile?.role === 'admin' && (
                                  <td className="px-6 py-4">
                                    <div className="font-medium">{reg.studentName}</div>
                                  </td>
                                )}
                                <td className="px-6 py-4">
                                  <span className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold uppercase tracking-wider ${
                                    reg.status === 'approved' ? 'bg-green-50 text-green-600' :
                                    reg.status === 'rejected' ? 'bg-red-50 text-red-600' :
                                    'bg-amber-50 text-amber-600'
                                  }`}>
                                    {reg.status === 'approved' && <CheckCircle size={12} />}
                                    {reg.status === 'rejected' && <XCircle size={12} />}
                                    {reg.status === 'pending' && <Clock size={12} />}
                                    {reg.status}
                                  </span>
                                </td>
                                <td className="px-6 py-4 text-right">
                                  {profile?.role === 'admin' ? (
                                    <div className="flex justify-end gap-2">
                                      {reg.status === 'pending' && (
                                        <>
                                          <button 
                                            onClick={() => updateRegistrationStatus(reg.id, 'approved')}
                                            className="p-2 text-green-600 hover:bg-green-50 rounded-lg transition-colors"
                                            title="Approve"
                                          >
                                            <CheckCircle size={18} />
                                          </button>
                                          <button 
                                            onClick={() => updateRegistrationStatus(reg.id, 'rejected')}
                                            className="p-2 text-red-600 hover:bg-red-50 rounded-lg transition-colors"
                                            title="Reject"
                                          >
                                            <XCircle size={18} />
                                          </button>
                                        </>
                                      )}
                                      <button 
                                        onClick={() => deleteRegistration(reg)}
                                        className="p-2 text-gray-400 hover:text-gray-600 rounded-lg transition-colors"
                                        title="Remove"
                                      >
                                        <Plus size={18} className="rotate-45" />
                                      </button>
                                    </div>
                                  ) : (
                                    reg.status === 'pending' && (
                                      <button 
                                        onClick={() => deleteRegistration(reg)}
                                        className="text-xs font-bold text-red-600 hover:underline"
                                      >
                                        Cancel Request
                                      </button>
                                    )
                                  )}
                                </td>
                              </tr>
                            ))
                          )}
                        </tbody>
                      </table>
                    </div>
                  </motion.div>
                )}

                {activeTab === 'admin-panel' && profile?.role === 'admin' && (
                  <motion.div 
                    key="admin"
                    initial={{ opacity: 0, x: 20 }}
                    animate={{ opacity: 1, x: 0 }}
                    exit={{ opacity: 0, x: -20 }}
                    className="space-y-6"
                  >
                    <h2 className="text-2xl font-serif font-bold">Administrative Controls</h2>
                    <div className="bg-white rounded-2xl p-8 shadow-sm border border-gray-100">
                      <h3 className="text-lg font-bold mb-4">System Overview</h3>
                      <p className="text-gray-600 mb-6">
                        As an administrator, you can manage course offerings, approve student registrations, and monitor enrollment trends.
                      </p>
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <div className="p-4 bg-gray-50 rounded-xl border border-gray-100">
                          <span className="text-xs text-gray-400 uppercase font-bold tracking-widest">Total Students</span>
                          <p className="text-2xl font-bold mt-1">Pending Sync</p>
                        </div>
                        <div className="p-4 bg-gray-50 rounded-xl border border-gray-100">
                          <span className="text-xs text-gray-400 uppercase font-bold tracking-widest">System Status</span>
                          <p className="text-2xl font-bold mt-1 text-green-600">Operational</p>
                        </div>
                      </div>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </main>
          </div>
        </div>

        {/* Add Subject Modal */}
        <AnimatePresence>
          {isAddingSubject && (
            <div className="fixed inset-0 z-[60] flex items-center justify-center p-4">
              <motion.div 
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                onClick={() => setIsAddingSubject(false)}
                className="absolute inset-0 bg-black/20 backdrop-blur-sm"
              />
              <motion.div 
                initial={{ opacity: 0, scale: 0.95, y: 20 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.95, y: 20 }}
                className="relative bg-white rounded-3xl shadow-2xl w-full max-w-lg overflow-hidden"
              >
                <div className="p-8">
                  <h2 className="text-2xl font-serif font-bold mb-6">New Course Offering</h2>
                  <form onSubmit={addSubject} className="space-y-4">
                    <div className="grid grid-cols-2 gap-4">
                      <div className="space-y-1">
                        <label className="text-xs font-bold text-gray-400 uppercase tracking-widest">Course Code</label>
                        <input name="code" required className="w-full px-4 py-2 bg-gray-50 border border-gray-100 rounded-xl focus:outline-none focus:ring-2 focus:ring-[#5A5A40]/20" placeholder="CS101" />
                      </div>
                      <div className="space-y-1">
                        <label className="text-xs font-bold text-gray-400 uppercase tracking-widest">Credits</label>
                        <input name="credits" type="number" required className="w-full px-4 py-2 bg-gray-50 border border-gray-100 rounded-xl focus:outline-none focus:ring-2 focus:ring-[#5A5A40]/20" placeholder="3" />
                      </div>
                    </div>
                    <div className="space-y-1">
                      <label className="text-xs font-bold text-gray-400 uppercase tracking-widest">Course Name</label>
                      <input name="name" required className="w-full px-4 py-2 bg-gray-50 border border-gray-100 rounded-xl focus:outline-none focus:ring-2 focus:ring-[#5A5A40]/20" placeholder="Introduction to Computer Science" />
                    </div>
                    <div className="space-y-1">
                      <label className="text-xs font-bold text-gray-400 uppercase tracking-widest">Description</label>
                      <textarea name="description" required rows={3} className="w-full px-4 py-2 bg-gray-50 border border-gray-100 rounded-xl focus:outline-none focus:ring-2 focus:ring-[#5A5A40]/20" placeholder="Brief course overview..." />
                    </div>
                    <div className="space-y-1">
                      <label className="text-xs font-bold text-gray-400 uppercase tracking-widest">Capacity</label>
                      <input name="capacity" type="number" required className="w-full px-4 py-2 bg-gray-50 border border-gray-100 rounded-xl focus:outline-none focus:ring-2 focus:ring-[#5A5A40]/20" placeholder="50" />
                    </div>
                    <div className="flex gap-3 pt-4">
                      <button 
                        type="button"
                        onClick={() => setIsAddingSubject(false)}
                        className="flex-1 py-3 bg-gray-100 text-gray-600 rounded-xl font-medium hover:bg-gray-200 transition-all"
                      >
                        Cancel
                      </button>
                      <button 
                        type="submit"
                        className="flex-1 py-3 bg-[#5A5A40] text-white rounded-xl font-medium hover:bg-[#4a4a35] shadow-md transition-all"
                      >
                        Create Subject
                      </button>
                    </div>
                  </form>
                </div>
              </motion.div>
            </div>
          )}
        </AnimatePresence>
      </div>
    </ErrorBoundary>
  );
}
