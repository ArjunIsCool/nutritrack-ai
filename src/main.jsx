import React, { useEffect, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Activity, Apple, ArrowDownRight, ArrowUpRight, BarChart3, Bell, CalendarDays, Check, ChevronDown, ChevronRight, CircleHelp, Clock3, CloudDownload, Coffee, Flame, Gauge, HeartPulse, History, Home, Leaf, LoaderCircle, LogOut, Menu, MessageSquareText, MoreHorizontal, Plus, Scale, Settings, ShieldCheck, Sparkles, Target, Trash2, Utensils, Wallet, X, Zap } from 'lucide-react';
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { deleteUser, onAuthStateChanged, reauthenticateWithPopup, signInWithPopup, signOut } from 'firebase/auth';
import { auth, firebaseConfigured, googleProvider } from './firebase';
import { deleteCloudData, deleteCloudMeal, replaceCloudData, saveCloudData, subscribeCloudData } from './cloudSync';
import './style.css';

const today = () => new Date().toISOString().slice(0,10);
const seedProfile = { age: 21, sex: 'male', height: 175, weight: 70, targetWeight: 65, activity: 'moderate', goal: 'lose', pace: 0.25 };
const seedMeals = [];
const read = (key, fallback) => { try { const value = localStorage.getItem(key); return value ? JSON.parse(value) : fallback; } catch { return fallback; } };
const fmt = n => Math.round(Number(n)||0).toLocaleString('en-IN');
const calcTargets = p => {
  const bmr = 10*p.weight + 6.25*p.height - 5*p.age + 5;
  const factors = { sedentary:1.2, light:1.375, moderate:1.55, high:1.725 };
  const tdee = bmr*(factors[p.activity] || 1.55);
  const adjustment = p.goal === 'lose' ? p.pace*7700/7 : p.goal === 'gain' ? p.pace*7700/7 : 0;
  const calories = Math.max(1500, Math.round(tdee + (p.goal === 'lose' ? -adjustment : adjustment)));
  const protein = Math.round(p.weight * (p.goal === 'gain' ? 1.8 : 1.6));
  const fat = Math.round(calories*.28/9);
  const carbs = Math.max(0, Math.round((calories-protein*4-fat*9)/4));
  return { bmr:Math.round(bmr), tdee:Math.round(tdee), calories, protein, carbs, fat };
};
const demoMeals = [
  {id:'demo1',date:today(),time:'08:30',category:'Breakfast',name:'Idli, sambar & chutney',items:[{name:'Idli (2 medium)',calories:116,protein:4,carbs:24,fat:1,fiber:2},{name:'Sambar (1 bowl)',calories:100,protein:5,carbs:15,fat:2,fiber:4},{name:'Coconut chutney (2 tbsp)',calories:70,protein:1,carbs:3,fat:6,fiber:1}],calories:286,protein:10,carbs:42,fat:9,fiber:7,sugar:4,assessment:'A balanced, familiar breakfast with useful fibre from sambar. Protein is moderate; consider adding a protein-rich side if this meal needs to keep you full longer.',quality:'Good',source:'demo'}
];

function App(){
  const [profile,setProfile] = useState(seedProfile);
  const [meals,setMeals] = useState(seedMeals);
  const [weights,setWeights] = useState([]);
  const [model,setModel] = useState('gemini-3.5-flash-lite');
  const [page,setPage] = useState('Dashboard');
  const [prompt,setPrompt] = useState('');
  const [category,setCategory] = useState('Meal');
  const [busy,setBusy] = useState(false);
  const [error,setError] = useState('');
  const [notice,setNotice] = useState('');
  const [draft,setDraft] = useState(null);
  const [showSetup,setShowSetup] = useState(false);
  const [mobileNav,setMobileNav] = useState(false);
  const [editingProfile,setEditingProfile] = useState(false);
  const [weightInput,setWeightInput] = useState('');
  const [showAll,setShowAll] = useState(false);
  const [authUser,setAuthUser] = useState(null);
  const [authLoading,setAuthLoading] = useState(true);
  const [cloudReady,setCloudReady] = useState(false);
  const [syncStatus,setSyncStatus] = useState('local');
  const [authError,setAuthError] = useState('');
  const [aiUsage,setAiUsage] = useState(null);
  const [usageLoading,setUsageLoading] = useState(false);
  const [access,setAccess] = useState(null);
  const [demoUsage,setDemoUsage] = useState(null);
  const [billingConsent,setBillingConsent] = useState(false);
  const [checkoutBusy,setCheckoutBusy] = useState(false);
  const [billingMessage,setBillingMessage] = useState('');
  const [billingError,setBillingError] = useState('');
  const [accountDeleteBusy,setAccountDeleteBusy] = useState(false);
  const [accountDeleteError,setAccountDeleteError] = useState('');
  const targets = useMemo(()=>calcTargets(profile),[profile]);
  const todayMeals = meals.filter(m=>m.date===today());
  const totals = todayMeals.reduce((a,m)=>({calories:a.calories+(+m.calories||0),protein:a.protein+(+m.protein||0),carbs:a.carbs+(+m.carbs||0),fat:a.fat+(+m.fat||0),fiber:a.fiber+(+m.fiber||0)}),{calories:0,protein:0,carbs:0,fat:0,fiber:0});
  const remaining = targets.calories-totals.calories;
  const progress = Math.min(100,totals.calories/targets.calories*100);
  useEffect(() => {
    if (!firebaseConfigured || !auth) { setAuthLoading(false); return undefined; }
    return onAuthStateChanged(auth, (user) => {
      setAuthUser(user);
      setCloudReady(false);
      setSyncStatus(user ? 'loading' : 'local');
      setAuthError('');
      setAuthLoading(false);
    }, (error) => {
      setAuthError(error.message || 'Could not check your sign-in status.');
      setAuthLoading(false);
    });
  }, []);
  useEffect(() => {
    if (!authUser) { setCloudReady(false); return undefined; }
    let active = true;
    let migrated = false;
    setCloudReady(false);
    setSyncStatus('loading');
    const unsubscribe = subscribeCloudData(authUser.uid, async (cloud, changed) => {
      if (!active) return;
      try {
        if (changed === 'initial' && !migrated && !cloud.hasCloudData) {
          migrated = true;
          const legacyProfile = read('nt_profile', null);
          const legacyMeals = read('nt_meals', null);
          const legacyWeights = read('nt_weights', null);
          const migratedProfile = legacyProfile || profile;
          const migratedMeals = Array.isArray(legacyMeals) ? legacyMeals : meals;
          const migratedWeights = Array.isArray(legacyWeights) ? legacyWeights : weights;
          if (legacyProfile) setProfile(legacyProfile);
          if (Array.isArray(legacyMeals)) setMeals(legacyMeals);
          if (Array.isArray(legacyWeights)) setWeights(legacyWeights);
          await saveCloudData(authUser.uid, { profile: migratedProfile, meals: migratedMeals, weights: migratedWeights });
          localStorage.removeItem('nt_profile');
          localStorage.removeItem('nt_meals');
          localStorage.removeItem('nt_weights');
          localStorage.removeItem('nt_setup_done');
        } else {
          migrated = true;
          if (changed === 'initial' || changed === 'profile') {
            if (cloud.profile) setProfile(current => JSON.stringify(current) === JSON.stringify(cloud.profile) ? current : cloud.profile);
            if (cloud.weights) setWeights(current => JSON.stringify(current) === JSON.stringify(cloud.weights) ? current : cloud.weights);
          }
          if (changed === 'initial' || changed === 'meals') {
            setMeals(current => {
              const currentById = new Map(current.map((meal) => [String(meal.id), meal]));
              const remoteById = new Map(cloud.meals.map((meal) => [String(meal.id), meal]));
              if (currentById.size === remoteById.size && [...remoteById].every(([id, meal]) => JSON.stringify(currentById.get(id)) === JSON.stringify(meal))) return current;
              return cloud.meals;
            });
          }
        }
        if (active) { setCloudReady(true); setSyncStatus('synced'); setAuthError(''); }
      } catch (error) {
        if (active) { setSyncStatus('error'); setAuthError(error.message || 'Cloud sync failed. Your account data is still available.'); }
      }
    }, (error) => {
      if (active) { setSyncStatus('error'); setAuthError(error.message || 'Cloud sync failed. Your account data is still available.'); }
    });
    return () => { active = false; unsubscribe(); };
  // Initial hydration is intentionally tied to the signed-in account only.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authUser?.uid]);
  useEffect(() => {
    if (!authUser || !cloudReady || accountDeleteBusy) return undefined;
    setSyncStatus('saving');
    const timer = setTimeout(() => {
      saveCloudData(authUser.uid, { profile, weights, meals })
        .then(() => setSyncStatus('synced'))
        .catch((error) => {
          setSyncStatus('error');
          setAuthError(error.message || 'Could not save to cloud. Your account data remains available.');
        });
    }, 900);
    return () => clearTimeout(timer);
  }, [authUser, cloudReady, profile, weights, meals, accountDeleteBusy]);
  useEffect(() => {
    if (!authUser) { setAiUsage(null); setAccess(null); setDemoUsage(null); return undefined; }
    let active = true;
    setUsageLoading(true);
    authUser.getIdToken().then(async token => {
      const headers = { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' };
      const [accessResponse, usageResponse] = await Promise.all([
        fetch('/api/access', { method: 'POST', headers, body: JSON.stringify({}) }),
        fetch('/api/usage', { method: 'POST', headers, body: JSON.stringify({}) }),
      ]);
      const accessData = await accessResponse.json();
      if (!accessResponse.ok) throw new Error(accessData?.error || 'Could not load account access.');
      const usageData = usageResponse.ok ? await usageResponse.json() : null;
      if (active) {
        setAccess(accessData.access);
        setDemoUsage(accessData.demoUsage);
        setAiUsage(usageData?.usage || null);
      }
    }).catch(() => {
      if (active) { setAiUsage(null); setAccess(null); setDemoUsage(null); }
    }).finally(() => {
      if (active) setUsageLoading(false);
    });
    return () => { active = false; };
  }, [authUser?.uid]);

  useEffect(()=>{ if('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(()=>{}); },[]);
  useEffect(()=>{ if(notice){const t=setTimeout(()=>setNotice(''),3200);return()=>clearTimeout(t);} },[notice]);

  const handleGoogleSignIn = async () => {
    if (!firebaseConfigured || !auth) {
      setAuthError('Cloud sign-in is not configured yet. Add the Firebase environment variables to enable it.');
      return;
    }
    setAuthError('');
    setAuthLoading(true);
    try { await signInWithPopup(auth, googleProvider); }
    catch (error) {
      setAuthError(error.code === 'auth/popup-closed-by-user' ? 'Sign-in window was closed.' : (error.message || 'Google sign-in failed.'));
    } finally { setAuthLoading(false); }
  };
  const handleSignOut = async () => {
    if (!auth) return;
    try {
      setCloudReady(false);
      await signOut(auth);
      setSyncStatus('local');
      setProfile(seedProfile); setMeals([]); setWeights([]); setAiUsage(null); setAccess(null); setDemoUsage(null);
      setNotice('Signed out.');
    } catch (error) { setAuthError(error.message || 'Could not sign out.'); }
  };
  const handleDeleteAccount = async () => {
    if (!authUser || !auth) return;
    const confirmed = window.confirm('Permanently delete your NutriTrack account? This removes your profile, meals, weight history and usage records, cancels any Razorpay subscription immediately, and deletes your sign-in account. This cannot be undone.');
    if (!confirmed) return;
    setAccountDeleteBusy(true);
    setAccountDeleteError('');
    setCloudReady(false);
    let deletionStarted = false;
    try {
      await reauthenticateWithPopup(authUser, googleProvider);
      deletionStarted = true;
      const token = await authUser.getIdToken(true);
      await deleteCloudData(authUser.uid);
      const response = await fetch('/api/delete-account-data', {
        method: 'POST',
        headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
        body: '{}'
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result.error || 'Could not remove account records.');
      await deleteUser(authUser);
      localStorage.removeItem('nt_profile');
      localStorage.removeItem('nt_meals');
      localStorage.removeItem('nt_weights');
      localStorage.removeItem('nt_setup_done');
      setProfile(seedProfile); setMeals([]); setWeights([]);
      setAiUsage(null); setAccess(null); setDemoUsage(null);
      setNotice('Your NutriTrack account has been permanently deleted.');
    } catch (error) {
      if (!deletionStarted) setCloudReady(true);
      const message = error.code === 'auth/popup-closed-by-user'
        ? 'Google re-authentication was cancelled. Your account was not deleted.'
        : error.code === 'auth/requires-recent-login'
          ? 'Please sign in with Google again, then retry account deletion.'
          : (error.message || 'Could not delete your account. Please try again.');
      setAccountDeleteError(message);
    } finally {
      setAccountDeleteBusy(false);
    }
  };
  const refreshAccountAccess = async () => {
    if (!authUser) return;
    try {
      const token = await authUser.getIdToken(true);
      const headers = { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' };
      const response = await fetch('/api/access', { method: 'POST', headers, body: '{}' });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Could not refresh access.');
      setAccess(data.access); setDemoUsage(data.demoUsage);
      const usageResponse = await fetch('/api/usage', { method: 'POST', headers, body: '{}' });
      if (usageResponse.ok) setAiUsage((await usageResponse.json()).usage);
      setBillingMessage('Account access refreshed.');
    } catch (error) { setBillingError(error.message || 'Could not refresh account access.'); }
  };
  const startSubscription = async (planCode) => {
    if (!billingConsent || !authUser || checkoutBusy) return;
    setCheckoutBusy(true); setBillingError(''); setBillingMessage('');
    try {
      const token = await authUser.getIdToken();
      const response = await fetch('/api/create-subscription', { method: 'POST', headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' }, body: JSON.stringify({ planCode }) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Could not create subscription.');
      if (!window.Razorpay) await new Promise((resolve, reject) => { const script = document.createElement('script'); script.src = 'https://checkout.razorpay.com/v1/checkout.js'; script.onload = resolve; script.onerror = () => reject(new Error('Could not load Razorpay Checkout.')); document.body.appendChild(script); });
      const checkout = data.checkout;
      const rzp = new window.Razorpay({ key: checkout.key, subscription_id: checkout.id, name: 'NutriTrack AI', description: planCode === 'monthly' ? '₹75 per month after 3-day trial' : '₹500 per year after 3-day trial', image: '/icons/icon-192.png', prefill: { name: authUser.displayName || '', email: authUser.email || '' }, notes: { product: 'NutriTrack AI', plan_code: planCode }, theme: { color: '#75a843' }, modal: { ondismiss: () => {
        setBillingMessage('Checkout closed. Checking whether the authorization can be safely retried…');
        authUser.getIdToken().then(token => fetch('/api/abandon-subscription', {
          method: 'POST',
          headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
          body: JSON.stringify({ subscriptionId: checkout.id })
        })).then(async response => {
          const result = await response.json().catch(() => ({}));
          if (!response.ok) throw new Error(result.error || 'Could not check the abandoned checkout.');
          setBillingMessage(result.released
            ? 'Previous checkout was safely closed. You can try again.'
            : 'Checkout is still being verified by Razorpay. Please wait before retrying.');
        }).catch(() => setBillingMessage('Checkout closed. If retry is blocked, refresh the page and try again in a moment.'));
      } }, handler: async (checkoutResponse) => {
        setBillingMessage('Verifying your subscription…');
        try {
          const token = await authUser.getIdToken();
          const verifyResponse = await fetch('/api/verify-subscription', {
            method: 'POST',
            headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
            body: JSON.stringify({
              subscriptionId: checkoutResponse.razorpay_subscription_id || checkout.id,
              paymentId: checkoutResponse.razorpay_payment_id,
              signature: checkoutResponse.razorpay_signature
            })
          });
          const result = await verifyResponse.json().catch(() => ({}));
          if (!verifyResponse.ok) throw new Error(result.error || 'Could not verify your subscription.');
          setBillingMessage('Subscription verified. Your three-day trial is now active.');
          await refreshAccountAccess();
        } catch (error) {
          setBillingError(error.message || 'Subscription verification failed. Please refresh access or contact support.');
        }
      } });
      rzp.on('payment.failed', event => setBillingError(event.error?.description || 'The authorization did not complete. You can try again.'));
      rzp.open();
    } catch (error) { setBillingError(error.message || 'Could not start checkout.'); }
    finally { setCheckoutBusy(false); }
  };
  const analyzeMeal = async () => {
    if(!prompt.trim()) return;
    if(!authUser){setError('Sign in to use AI meal analysis.');return;}
    setBusy(true);setError('');setDraft(null);
    try{
      const token=await authUser.getIdToken();
      const demoMode = access?.status !== 'trialing' && access?.status !== 'active';
      const endpoint = demoMode ? '/api/demo-analysis' : '/api/meal-analysis';
      const res=await fetch(endpoint,{method:'POST',headers:{'Content-Type':'application/json','Authorization':`Bearer ${token}`},body:JSON.stringify({prompt,category,model})});
      const data=await res.json();
      if (data?.usage) setAiUsage(data.usage);
      if (data?.demoUsage) setDemoUsage(data.demoUsage);
      if(!res.ok) {
        const retry = data?.retryAfter ? ` Try again in about ${data.retryAfter} seconds.` : '';
        throw new Error((data?.error||`Meal analysis failed (${res.status})`) + retry);
      }
      const parsed=JSON.parse((data.text||'').replace(/^\x60\x60\x60json\s*/,'').replace(/\x60\x60\x60$/,''));
      setDraft({...parsed,category,rawPrompt:prompt,date:today(),time:new Date().toLocaleTimeString([],{hour:'2-digit',minute:'2-digit',hour12:false})});
    }catch(e){setError(e.message||'Could not analyse this meal. Please check your sign-in and connection.');}
    finally{setBusy(false);}
  };
  const saveMeal=()=>{if(!draft)return;const t=draft.totals||{};const meal={id:crypto.randomUUID?.()||String(Date.now()),date:draft.date||today(),time:draft.time||'12:00',category:draft.category||'Meal',name:draft.meal_name||'Meal',items:draft.items||[],calories:+t.calories||0,protein:+t.protein||0,carbs:+t.carbs||0,fat:+t.fat||0,fiber:+t.fiber||0,sugar:+t.sugar||0,assessment:draft.assessment||'',quality:draft.quality||'Moderate',source:'gemini'};setMeals(prev=>[meal,...prev]);setDraft(null);setPrompt('');setPage('Dashboard');setNotice('Meal saved to today’s log.');};
  const removeMeal=id=>{setMeals(m=>m.filter(x=>x.id!==id));if(authUser&&cloudReady)deleteCloudMeal(authUser.uid,id).catch(error=>{setSyncStatus('error');setAuthError(error.message||'Could not delete this meal from the cloud.');});setNotice('Meal deleted.');};
  const saveProfile=()=>{setEditingProfile(false);setNotice('Your goals have been updated.');};
  const saveWeight=()=>{const n=Number(weightInput);if(!n||n<25||n>350)return;setWeights(w=>[{date:today(),weight:n},...w.filter(x=>x.date!==today())]);setProfile(p=>({...p,weight:n}));setWeightInput('');setNotice('Weight entry saved.');};
  const exportData=()=>{const data={app:'NutriTrack AI',version:1,exportedAt:new Date().toISOString(),profile,meals,weights};const blob=new Blob([JSON.stringify(data,null,2)],{type:'application/json'});const url=URL.createObjectURL(blob);const a=document.createElement('a');a.href=url;a.download=`nutritrack-backup-${today()}.json`;a.click();URL.revokeObjectURL(url);setNotice('Backup exported.');};
  const importData=e=>{const file=e.target.files?.[0];if(!file)return;const reader=new FileReader();reader.onload=async()=>{try{const d=JSON.parse(reader.result);if(d.app!=='NutriTrack AI'||!Array.isArray(d.meals)||!d.profile)throw new Error('This does not look like a NutriTrack AI backup.');if(!confirm(`Import ${d.meals.length} meals and replace current profile/history?`))return;const nextWeights=Array.isArray(d.weights)?d.weights:[];if(authUser)await replaceCloudData(authUser.uid,{profile:d.profile,meals:d.meals,weights:nextWeights});setProfile(d.profile);setMeals(d.meals);setWeights(nextWeights);setNotice('Backup imported successfully.');}catch(err){setError(err.message||'Could not read backup file.');}};reader.readAsText(file);e.target.value='';};
  const testConnection=async()=>{
    if(!authUser){setError('Sign in with Google before testing AI.');return;}
    setBusy(true);setError('');
    try{
      const token=await authUser.getIdToken();
      const r=await fetch('/api/ai-status',{method:'POST',headers:{'Authorization':`Bearer ${token}`,'Content-Type':'application/json'},body:JSON.stringify({model})});
      const d=await r.json();
      if(!r.ok)throw new Error(d?.error||`Request failed (${r.status})`);
      setNotice('NutriTrack AI service is connected.');
    }catch(e){setError(e.message||'Connection test failed.');}
    finally{setBusy(false);}
  };
  const nav=[['Dashboard',Home],['AI Food Logger',MessageSquareText],['Meal History',History],['Analytics',BarChart3],['Goals',Target],['Billing',Wallet],['Settings',Settings]];
  const chartData=Array.from({length:7},(_,i)=>{const d=new Date();d.setDate(d.getDate()-(6-i));const key=d.toISOString().slice(0,10);return {day:d.toLocaleDateString('en',{weekday:'short'}),calories:meals.filter(m=>m.date===key).reduce((s,m)=>s+(+m.calories||0),0)};});
  const displayMeals=showAll?meals:meals.slice(0,5);
  if (authLoading) return <div className="auth-gate"><div className="auth-gate-card"><div className="brand-mark"><Apple size={23}/></div><h1>NutriTrack <span>AI</span></h1><p>Checking your account…</p><LoaderCircle className="spin" size={22}/></div></div>;
  if (authUser && !cloudReady && !accountDeleteError) return <div className="auth-gate"><div className="auth-gate-card"><div className="brand-mark"><Apple size={23}/></div><h1>NutriTrack <span>AI</span></h1>{syncStatus === 'error' ? <><p>We couldn't load your account data. Your account has not been switched to local storage.</p><div className="error-box">{authError || 'Cloud data could not be loaded.'}</div><button className="secondary-btn" onClick={()=>window.location.reload()}>Retry</button></> : <><p>Loading your secure account data…</p><LoaderCircle className="spin" size={22}/></>}</div></div>;
  if (!authUser) return <div className="auth-gate"><div className="auth-gate-card"><div className="brand-mark"><Apple size={23}/></div><div className="setup-step">YOUR DAILY NUTRITION COMPANION</div><h1>NutriTrack <span>AI</span></h1><p>Create an account or sign in to securely save your nutrition profile, meals and progress across devices.</p>{authError&&<div className="error-box">{authError}</div>}<button className="primary-btn full-btn" onClick={handleGoogleSignIn} disabled={authLoading||!firebaseConfigured}>{authLoading?<LoaderCircle className="spin" size={17}/>:<ShieldCheck size={17}/>} Continue with Google</button>{!firebaseConfigured&&<small>Sign-in is temporarily unavailable while account services are configured.</small>}<div className="auth-benefits"><span><Check size={14}/> Five free AI demo analyses</span><span><Check size={14}/> Your data saved to your account</span><span><Check size={14}/> Optional three-day premium trial</span></div></div></div>;
  return <div className="app-shell">
    <aside className={`sidebar ${mobileNav?'open':''}`}>
      <div className="brand"><div className="brand-mark"><Apple size={21}/></div><div><strong>NutriTrack <span>AI</span></strong><small>YOUR DAILY NUTRITION</small></div><button className="mobile-close icon-btn" onClick={()=>setMobileNav(false)}><X size={18}/></button></div>
      <div className="nav-label">WORKSPACE</div>
      <nav>{nav.map(([name,Icon])=><button key={name} className={`nav-item ${page===name?'active':''}`} onClick={()=>{setPage(name);setMobileNav(false);}}><Icon size={18}/><span>{name}</span>{name==='AI Food Logger'&&<span className="nav-new">AI</span>}</button>)}</nav>
      <div className="sidebar-bottom"><div className="streak-card"><div className="streak-icon"><Zap size={17}/></div><div><b>Small steps, daily.</b><p>Consistency beats perfection.</p></div></div><button className="profile-mini" onClick={()=>setPage('Goals')}><div className="avatar">{profile.sex==='male'?'Y':'N'}</div><div><b>Your profile</b><small>{profile.weight} kg · {profile.height} cm</small></div><ChevronRight size={16}/></button></div>
    </aside>
    {mobileNav&&<div className="scrim" onClick={()=>setMobileNav(false)}/>}
    <main className="main-area">
      <header className="topbar"><div className="top-left"><button className="icon-btn mobile-menu" onClick={()=>setMobileNav(true)}><Menu size={20}/></button><div><div className="eyebrow">THURSDAY, {new Date().toLocaleDateString('en-US',{month:'long',day:'numeric',year:'numeric'}).toUpperCase()}</div><h1>{page==='Dashboard'?'Your daily overview':page}</h1></div></div><div className="top-actions"><div className="local-pill"><span className="live-dot"/> {authUser ? (syncStatus === 'synced' ? 'Cloud synced' : syncStatus === 'saving' ? 'Syncing…' : syncStatus === 'error' ? 'Sync issue' : 'Connecting…') : 'Saved on this device'}</div><button className="icon-btn" title="Settings" onClick={()=>setPage('Settings')}><Settings size={19}/></button><div className="avatar top-avatar">Y</div></div></header>
      <div className="content">
        {page==='Dashboard'&&<>
          <section className="welcome-row"><div><h2>Good day. <span>Let’s make it count.</span></h2><p>A little awareness at every meal adds up.</p></div><button className="primary-btn" onClick={()=>setPage('AI Food Logger')}><Plus size={17}/> Log a meal</button></section>
          <section className="stats-grid">
            <div className="card calorie-card"><div className="card-head"><span>CALORIES CONSUMED</span><div className="metric-icon orange"><Flame size={17}/></div></div><div className="calorie-main"><div><strong>{fmt(totals.calories)}</strong><small>kcal eaten today</small></div><div className="ring" style={{'--progress':`${progress}%`}}><div><b>{Math.round(progress)}%</b><small>of goal</small></div></div></div><div className="progress-track"><span style={{width:`${progress}%`}}/></div><div className="card-foot"><span>Daily goal <b>{fmt(targets.calories)} kcal</b></span><span className={remaining>=0?'green-text':'orange-text'}>{fmt(Math.abs(remaining))} {remaining>=0?'remaining':'over'}</span></div></div>
            <div className="card macro-card"><div className="card-head"><span>MACRONUTRIENTS</span><div className="metric-icon green"><Activity size={17}/></div></div><div className="macro-list">{[['Protein',totals.protein,targets.protein,'blue'],['Carbs',totals.carbs,targets.carbs,'yellow'],['Fat',totals.fat,targets.fat,'purple']].map(([n,v,g,c])=><div className="macro-row" key={n}><div className="macro-label"><span>{n}</span><b>{fmt(v)} <small>/ {fmt(g)}g</small></b></div><div className="progress-track"><i className={c} style={{width:`${Math.min(100,v/g*100)}%`}}/></div></div>)}</div><div className="macro-note"><Leaf size={14}/> Protein target supports muscle maintenance.</div></div>
            <div className="card goal-card"><div className="card-head"><span>YOUR WEIGHT GOAL</span><div className="metric-icon violet"><Target size={17}/></div></div><div className="weight-pair"><div><strong>{profile.weight}<small> kg</small></strong><span>Current</span></div><ArrowDownRight className="goal-arrow" size={22}/><div><strong>{profile.targetWeight}<small> kg</small></strong><span>Target</span></div></div><div className="goal-divider"/><div className="goal-bottom"><span>{profile.goal==='lose'?'Weight loss':profile.goal==='gain'?'Weight gain':'Maintenance'} plan</span><button className="text-btn" onClick={()=>setPage('Goals')}>View goals <ChevronRight size={14}/></button></div></div>
          </section>
          <section className="dashboard-grid"><div className="card chart-card"><div className="section-head"><div><h3>Calorie overview</h3><p>Your intake over the last 7 days</p></div><span className="chart-legend"><i/> Calories</span></div><div className="chart-wrap"><ResponsiveContainer width="100%" height="100%"><AreaChart data={chartData} margin={{top:12,right:4,left:-20,bottom:0}}><defs><linearGradient id="calFill" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#a7d96b" stopOpacity={.25}/><stop offset="95%" stopColor="#a7d96b" stopOpacity={0}/></linearGradient></defs><CartesianGrid stroke="#292e27" strokeDasharray="3 5" vertical={false}/><XAxis dataKey="day" axisLine={false} tickLine={false} tick={{fill:'#858d7e',fontSize:11}} dy={10}/><YAxis axisLine={false} tickLine={false} tick={{fill:'#858d7e',fontSize:10}}/><Tooltip contentStyle={{background:'#20251e',border:'1px solid #343c30',borderRadius:10,color:'#f4f5ef'}}/><Area type="monotone" dataKey="calories" stroke="#a7d96b" strokeWidth={2.5} fill="url(#calFill)"/></AreaChart></ResponsiveContainer></div><div className="chart-bottom"><span>Daily target</span><b>{fmt(targets.calories)} kcal</b></div></div>
            <div className="card quick-card"><div className="section-head"><div><h3>Quick actions</h3><p>Keep your routine moving</p></div><MoreHorizontal size={18} className="muted"/></div><button className="quick-action" onClick={()=>setPage('AI Food Logger')}><div className="quick-icon green"><MessageSquareText size={18}/></div><div><b>Log a meal with AI</b><small>Describe what you ate</small></div><ChevronRight size={17}/></button><button className="quick-action" onClick={()=>setPage('Goals')}><div className="quick-icon violet"><Scale size={18}/></div><div><b>Update your weight</b><small>Keep your progress current</small></div><ChevronRight size={17}/></button><button className="quick-action" onClick={()=>setPage('Analytics')}><div className="quick-icon orange"><BarChart3 size={18}/></div><div><b>Review your trends</b><small>See your nutrition patterns</small></div><ChevronRight size={17}/></button></div></section>
          <section className="card recent-card"><div className="section-head"><div><h3>Recent meals</h3><p>Your latest food entries</p></div><button className="text-btn" onClick={()=>setPage('Meal History')}>View history <ChevronRight size={14}/></button></div>{displayMeals.length===0?<EmptyState icon={Utensils} title="No meals logged yet" desc="Your meals will appear here once you start tracking." action="Log your first meal" onClick={()=>setPage('AI Food Logger')}/>:<div className="meal-list">{displayMeals.map(m=><MealRow key={m.id} meal={m} onDelete={removeMeal}/>)}</div>}</section>
        </>}
        {page==='AI Food Logger'&&<><div className="page-intro"><div className="ai-badge"><Sparkles size={14}/> GEMINI-POWERED MEAL ANALYSIS</div><h2>What did you eat?</h2><p>Describe your meal naturally. NutriTrack will estimate the nutrition and explain the meal quality.</p></div><div className="logger-layout"><div className="card logger-card"><div className="logger-top"><div className="logger-icon"><Sparkles size={20}/></div><div><b>AI meal assistant</b><small>Nutrition estimates, made simple</small></div><span className="secure-label"><ShieldCheck size={13}/> Private log</span></div>{access?.status === 'trialing' || access?.status === 'active' ? <div className="field-help">{usageLoading?'Loading AI usage…':aiUsage?`AI analyses: ${aiUsage.daily.used}/${aiUsage.daily.limit} today · ${aiUsage.monthly.used}/${aiUsage.monthly.limit} this month`:'AI usage information is temporarily unavailable.'}</div> : <div className="demo-meter"><b>{demoUsage?.remaining ?? '—'} of 5 free demo analyses remaining</b><small>Try NutriTrack before starting your card-verified 3-day trial.</small></div>}<label className="field-label">MEAL TYPE</label><div className="meal-types">{['Breakfast','Lunch','Dinner','Snack'].map(x=><button key={x} className={category===x?'selected':''} onClick={()=>setCategory(x)}>{x==='Breakfast'?<Coffee size={15}/>:x==='Snack'?<Apple size={15}/>:<Utensils size={15}/>} {x}</button>)}</div><label className="field-label" htmlFor="meal-prompt">DESCRIBE YOUR MEAL</label><textarea id="meal-prompt" value={prompt} onChange={e=>setPrompt(e.target.value)} placeholder="e.g. I had 2 medium dosas, one bowl of sambar and 2 tablespoons of coconut chutney..." rows={5}/><div className="prompt-hint"><CircleHelp size={14}/> Include portion sizes and cooking methods for better estimates.</div>{error&&<div className="error-box"><X size={15}/>{error}</div>}<button className="primary-btn full-btn" onClick={analyzeMeal} disabled={busy||!prompt.trim()||(access?.status !== 'trialing' && access?.status !== 'active' && !!demoUsage && demoUsage.remaining<=0)||((access?.status === 'trialing'||access?.status === 'active')&&!!aiUsage&&(aiUsage.daily.remaining<=0||aiUsage.monthly.remaining<=0))}>{busy?<><LoaderCircle className="spin" size={17}/> Analysing your meal...</>:<><Sparkles size={17}/> Analyse meal</>}</button><div className="privacy-note"><ShieldCheck size={14}/> Your prompt is sent to Google Gemini for analysis. Your saved meal records sync to your account.</div></div><div className="card tips-card"><div className="tips-icon"><Zap size={18}/></div><h3>Get better estimates</h3><ul><li>Mention the number of pieces or serving size.</li><li>Include oil, ghee, butter or sauces when you can.</li><li>Say whether food was homemade or restaurant-prepared.</li></ul><div className="example-prompt"><small>EXAMPLE PROMPT</small><p>“2 homemade chapatis, 1 cup dal tadka with 1 tsp ghee, and a small bowl of cucumber raita.”</p></div></div></div>{draft&&<div className="card draft-card"><div className="section-head"><div><div className="ai-badge"><Sparkles size={13}/> AI ESTIMATE</div><h3>{draft.meal_name||'Meal breakdown'}</h3><p>Review the estimate before saving.</p></div><button className="icon-btn" onClick={()=>setDraft(null)}><X size={18}/></button></div>{draft.needs_clarification&&<div className="warning-box"><CircleHelp size={16}/><div><b>One detail could improve accuracy</b><p>{draft.clarifying_question}</p></div></div>}<div className="draft-total"><strong>{fmt(draft.totals?.calories)}</strong><span>kcal estimated</span><span className="quality-pill">{draft.quality||'Estimated'}</span></div><div className="draft-macros">{[['Protein',draft.totals?.protein,'blue'],['Carbs',draft.totals?.carbs,'yellow'],['Fat',draft.totals?.fat,'purple'],['Fibre',draft.totals?.fiber,'green']].map(([n,v,c])=><div key={n}><span>{n}</span><b>{fmt(v)}g</b></div>)}</div><div className="food-breakdown">{(draft.items||[]).map((it,i)=><div className="food-line" key={i}><div><b>{it.name}</b><small>{fmt(it.protein)}g protein · {fmt(it.carbs)}g carbs · {fmt(it.fat)}g fat</small></div><strong>{fmt(it.calories)} <small>kcal</small></strong></div>)}</div><div className="assessment"><div><HeartPulse size={17}/> Meal quality assessment</div><p>{draft.assessment}</p>{draft.assumptions?.length>0&&<small>Assumptions: {draft.assumptions.join('; ')}</small>}</div><div className="draft-actions"><button className="secondary-btn" onClick={()=>setDraft(null)}>Discard</button><button className="primary-btn" onClick={saveMeal}><Check size={17}/> Save meal to diary</button></div></div>}</>}
        {page==='Meal History'&&<><div className="page-intro"><h2>Your food diary</h2><p>Every meal, in one place. Review and manage your nutrition history.</p></div><div className="card history-card"><div className="section-head"><div><h3>All meals</h3><p>{meals.length} meals recorded on this device</p></div><button className="primary-btn small-btn" onClick={()=>setPage('AI Food Logger')}><Plus size={16}/> Add meal</button></div>{meals.length===0?<EmptyState icon={History} title="Your diary is empty" desc="Start by logging your first meal with AI." action="Log a meal" onClick={()=>setPage('AI Food Logger')}/>:<div className="meal-list">{meals.map(m=><MealRow key={m.id} meal={m} onDelete={removeMeal} showDate/>)}</div>}</div></>}
        {page==='Analytics'&&<><div className="page-intro"><h2>Your nutrition insights</h2><p>Look beyond individual meals and understand your habits over time.</p></div><div className="stats-grid analytics-stats"><StatCard icon={Flame} label="TODAY'S INTAKE" value={`${fmt(totals.calories)} kcal`} sub={`${Math.round(progress)}% of daily goal`} color="orange"/><StatCard icon={Activity} label="PROTEIN TODAY" value={`${fmt(totals.protein)} g`} sub={`Target ${targets.protein} g`} color="green"/><StatCard icon={CalendarDays} label="MEALS LOGGED" value={todayMeals.length} sub="Today" color="violet"/></div><div className="card chart-card analytics-chart"><div className="section-head"><div><h3>Daily calorie intake</h3><p>Last seven days</p></div><span className="chart-legend"><i/> Calories</span></div><div className="chart-wrap tall"><ResponsiveContainer width="100%" height="100%"><AreaChart data={chartData} margin={{top:12,right:10,left:-18,bottom:0}}><defs><linearGradient id="anaFill" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#a7d96b" stopOpacity={.25}/><stop offset="95%" stopColor="#a7d96b" stopOpacity={0}/></linearGradient></defs><CartesianGrid stroke="#292e27" strokeDasharray="3 5" vertical={false}/><XAxis dataKey="day" axisLine={false} tickLine={false} tick={{fill:'#858d7e',fontSize:12}} dy={10}/><YAxis axisLine={false} tickLine={false} tick={{fill:'#858d7e',fontSize:11}}/><Tooltip contentStyle={{background:'#20251e',border:'1px solid #343c30',borderRadius:10,color:'#f4f5ef'}}/><Area type="monotone" dataKey="calories" stroke="#a7d96b" strokeWidth={2.5} fill="url(#anaFill)"/></AreaChart></ResponsiveContainer></div></div><div className="card insight-card"><div className="insight-icon"><Sparkles size={18}/></div><div><b>Build a useful baseline</b><p>Log meals consistently for at least 7–14 days. Your trend data will become more informative as you build a history.</p></div></div></>}
        {page==='Goals'&&<><div className="page-intro"><h2>Your goals, your pace</h2><p>Set a realistic target. Your daily nutrition budget updates automatically.</p></div><div className="goals-layout"><div className="card goal-form"><div className="section-head"><div><h3>Personal profile & goals</h3><p>Used to estimate your energy needs</p></div><button className="text-btn" onClick={()=>setEditingProfile(!editingProfile)}>{editingProfile?'Cancel':'Edit details'}</button></div><div className="profile-grid"><NumberField label="Age" value={profile.age} suffix="years" disabled={!editingProfile} onChange={v=>setProfile(p=>({...p,age:+v}))}/><NumberField label="Height" value={profile.height} suffix="cm" disabled={!editingProfile} onChange={v=>setProfile(p=>({...p,height:+v}))}/><NumberField label="Current weight" value={profile.weight} suffix="kg" disabled={!editingProfile} onChange={v=>setProfile(p=>({...p,weight:+v}))}/><NumberField label="Target weight" value={profile.targetWeight} suffix="kg" disabled={!editingProfile} onChange={v=>setProfile(p=>({...p,targetWeight:+v}))}/></div>{editingProfile&&<button className="primary-btn" onClick={saveProfile}>Save profile</button>}<div className="form-divider"/><label className="field-label">YOUR OBJECTIVE</label><div className="goal-options">{[['lose','Lose weight',ArrowDownRight],['maintain','Maintain',Scale],['gain','Gain weight',ArrowUpRight]].map(([v,l,I])=><button key={v} className={profile.goal===v?'chosen':''} onClick={()=>setProfile(p=>({...p,goal:v}))}><I size={18}/><b>{l}</b></button>)}</div><label className="field-label">ACTIVITY LEVEL</label><select value={profile.activity} onChange={e=>setProfile(p=>({...p,activity:e.target.value}))}><option value="sedentary">Sedentary – little or no exercise</option><option value="light">Light – exercise 1–3 days/week</option><option value="moderate">Moderate – exercise 3–5 days/week</option><option value="high">Very active – hard exercise most days</option></select>{profile.goal!=='maintain'&&<><label className="field-label">DESIRED WEEKLY CHANGE</label><div className="pace-options">{[0.25,0.5,0.75].map(v=><button key={v} className={profile.pace===v?'chosen':''} onClick={()=>setProfile(p=>({...p,pace:v}))}><b>{v} kg</b><small>per week</small></button>)}</div></>}<div className="form-divider"/><label className="field-label">WEIGHT CHECK-IN</label><div className="weight-entry"><input type="number" step="0.1" placeholder="Today's weight in kg" value={weightInput} onChange={e=>setWeightInput(e.target.value)}/><button className="secondary-btn" onClick={saveWeight}>Save weight</button></div></div><div className="goals-side"><div className="card target-card"><div className="metric-icon green"><Target size={18}/></div><span>ESTIMATED DAILY CALORIE TARGET</span><strong>{fmt(targets.calories)}</strong><small>kcal per day</small><div className="target-row"><span>Estimated BMR</span><b>{fmt(targets.bmr)} kcal</b></div><div className="target-row"><span>Estimated TDEE</span><b>{fmt(targets.tdee)} kcal</b></div><div className="target-row"><span>Goal adjustment</span><b>{profile.goal==='maintain'?'0':`${profile.goal==='lose'?'−':'+'}${fmt(profile.pace*7700/7)} kcal`}</b></div></div><div className="card macro-target-card"><h3>Suggested macro targets</h3><p>Starting estimates to support your goal.</p>{[['Protein',targets.protein,'blue'],['Carbohydrates',targets.carbs,'yellow'],['Fat',targets.fat,'purple']].map(([n,v,c])=><div className="target-row" key={n}><span><i className={`dot ${c}`}/>{n}</span><b>{v} g</b></div>)}</div><div className="safety-note"><ShieldCheck size={17}/><p>These are estimates, not medical advice. Actual needs vary. Avoid aggressive weight changes and consult a qualified professional if you have medical or dietary concerns.</p></div></div></div></>}

        {page==='Billing'&&<><div className="page-intro"><h2>Choose your NutriTrack plan</h2><p>Start with a card-authorized three-day trial. Your selected plan begins billing after the trial.</p></div>
          <div className="card settings-card billing-status"><div className="settings-title"><div className="settings-icon"><Wallet size={19}/></div><div><h3>Current access</h3><p>{access?.status === 'trialing' ? 'Your three-day trial is active.' : access?.status === 'active' ? 'Your subscription is active.' : 'You are currently using demo access.'}</p></div><span className="quality-pill good">{access?.status || 'Loading'}</span></div>
          {access?.trialEndsAt&&access.status==='trialing'&&<p className="field-help">Trial ends: {new Date(access.trialEndsAt).toLocaleString('en-IN')}</p>}
          {access?.paidUntil&&<p className="field-help">Access through: {new Date(access.paidUntil).toLocaleDateString('en-IN')}</p>}
          <button className="secondary-btn" onClick={refreshAccountAccess}>Refresh access</button>
          {billingMessage&&<div className="field-help">{billingMessage}</div>}{billingError&&<div className="error-box">{billingError}</div>}
          </div>
          <div className="grid-two billing-plans">
            <div className="card settings-card"><div className="setup-step">MONTHLY</div><h2>₹75 <small>/ month</small></h2><p>Flexible monthly billing after your trial.</p><ul><li>Three-day trial</li><li>20 AI analyses per day</li><li>500 AI analyses per month</li></ul><button className="primary-btn full-btn" disabled={!billingConsent||checkoutBusy||access?.status==='trialing'||access?.status==='active'} onClick={()=>startSubscription('monthly')}>{checkoutBusy?'Opening checkout…':'Start monthly trial'}</button></div>
            <div className="card settings-card"><div className="setup-step">ANNUAL</div><h2>₹500 <small>/ year</small></h2><p>One annual payment after your trial.</p><ul><li>Three-day trial</li><li>20 AI analyses per day</li><li>500 AI analyses per month</li></ul><button className="primary-btn full-btn" disabled={!billingConsent||checkoutBusy||access?.status==='trialing'||access?.status==='active'} onClick={()=>startSubscription('annual')}>{checkoutBusy?'Opening checkout…':'Start annual trial'}</button></div>
          </div>
          <div className="card settings-card"><label className="consent-row"><input type="checkbox" checked={billingConsent} onChange={e=>setBillingConsent(e.target.checked)}/><span>I authorize recurring payments for the plan I select. After the three-day trial, ₹75 will be charged monthly or ₹500 annually, depending on my selection, until I cancel. I understand Razorpay may perform a nominal payment-method authorization.</span></label><div className="field-help">The first charge date is three days after successful authorization. Razorpay Checkout displays the subscription authorization details. A trial is activated only after the server verifies the provider notification.</div></div>
        </>}
        {page==='Settings'&&<><div className="page-intro"><h2>Settings & integrations</h2><p>Configure your AI provider and manage your personal data.</p></div><div className="settings-layout">
          <div className="card settings-card">
            <div className="settings-title"><div className="settings-icon"><ShieldCheck size={19}/></div><div><h3>Account & cloud sync</h3><p>Sign in to keep your nutrition history across devices.</p></div><span className={authUser ? 'connected-dot' : ''}/></div>
            {!firebaseConfigured && <div className="field-help">Google sign-in is not configured yet. Follow <b>docs/FIREBASE_SETUP.md</b>, add the Firebase environment variables and redeploy.</div>}
            {authUser ? <>
              <div className="account-summary"><div className="avatar">{(authUser.displayName || authUser.email || 'N').slice(0,1).toUpperCase()}</div><div><b>{authUser.displayName || 'NutriTrack user'}</b><small>{authUser.email}</small></div><span className="quality-pill good">Signed in</span></div>
              <div className="field-help">{syncStatus === 'synced' ? 'Your profile, meals and weight history are backed up to your account.' : syncStatus === 'saving' || syncStatus === 'loading' ? 'Synchronizing your data with the cloud…' : syncStatus === 'error' ? 'Cloud sync needs attention. Your local data is still available.' : 'Cloud synchronization is initializing.'}</div>
              <button className="secondary-btn" onClick={handleSignOut}><LogOut size={15}/> Sign out</button>
            </> : <button className="primary-btn" onClick={handleGoogleSignIn} disabled={authLoading || !firebaseConfigured}>{authLoading ? <LoaderCircle className="spin" size={16}/> : <ShieldCheck size={16}/>} Continue with Google</button>}
            {authError && <div className="error-box">{authError}</div>}
            <div className="field-help">Your account is the source of truth for your nutrition data.</div>
          </div>
          <div className="card settings-card"><div className="settings-title"><div className="settings-icon gemini"><Sparkles size={19}/></div><div><h3>NutriTrack AI</h3><p>Managed Gemini service for meal analysis.</p></div><span className="connected-dot"/></div><div className="field-help">AI requests are securely sent through NutriTrack's server. Your API key is never stored in this browser.</div><label className="field-label">GEMINI MODEL</label><select value={model} onChange={e=>{setModel(e.target.value);}}><option value="gemini-3.5-flash-lite">Gemini 3.5 Flash-Lite · lower cost</option><option value="gemini-3.8-flash">Gemini 3.8 Flash</option></select><div className="settings-actions"><button className="secondary-btn" onClick={testConnection} disabled={busy||!authUser}>{busy?<LoaderCircle className="spin" size={15}/>:<Zap size={15}/>} Test AI service</button></div>{!authUser&&<div className="field-help">Sign in with Google in the Account & cloud sync section to use AI.</div>}{error&&<div className="error-box">{error}</div>}</div>
          <div className="card settings-card"><div className="settings-title"><div className="settings-icon"><Wallet size={19}/></div><div><h3>Data & backups</h3><p>Your meals and profile are stored in your cloud account.</p></div></div><div className="storage-info"><div><b>{meals.length}</b><small>Meals stored</small></div><div><b>{weights.length}</b><small>Weight entries</small></div><div><b>{authUser ? (syncStatus === 'synced' ? 'Cloud' : 'Pending') : 'Local'}</b><small>Storage mode</small></div></div><button className="backup-action" onClick={exportData}><CloudDownload size={17}/><div><b>Export backup</b><small>Download profile, meals and weight history as JSON</small></div><ChevronRight size={16}/></button><label className="backup-action import-label"><CloudDownload size={17}/><div><b>Import backup</b><small>Restore from a NutriTrack JSON backup</small></div><ChevronRight size={16}/><input type="file" accept="application/json,.json" onChange={importData}/></label><div className="field-help">Import replaces your account profile and history. Export backups regularly.</div></div>
          <div className="card settings-card"><div className="settings-title"><div className="settings-icon"><ShieldCheck size={19}/></div><div><h3>Privacy & security</h3><p>Understand where your information goes.</p></div></div><div className="privacy-list"><p><Check size={15}/> Meal history and goals are stored in your authenticated cloud account.</p><p><Check size={15}/> Only meal prompts are sent to Gemini when you request analysis.</p><p><Check size={15}/> An account is required to access NutriTrack AI.</p><p><Check size={15}/> Gemini credentials are kept on the server and are not exposed in the browser.</p></div><button className="danger-btn" onClick={handleDeleteAccount} disabled={accountDeleteBusy}>{accountDeleteBusy?<LoaderCircle className="spin" size={15}/>:<Trash2 size={15}/>} {accountDeleteBusy?'Deleting account…':'Delete account permanently'}</button>{accountDeleteError&&<div className="error-box">{accountDeleteError}</div>}<div className="field-help">Permanently deletes your sign-in, cloud data and usage records. Any Razorpay subscription is cancelled immediately before deletion.</div></div></div></>}
      </div>
      <footer className="footer"><span>© {new Date().getFullYear()} NutriTrack AI</span><span>Made for mindful everyday nutrition <HeartPulse size={13}/></span></footer>
    </main>
    {showSetup&&<div className="modal-backdrop"><div className="setup-modal"><div className="setup-brand"><div className="brand-mark"><Apple size={22}/></div><span>NutriTrack <b>AI</b></span></div><div className="setup-step">WELCOME · QUICK SETUP</div><h2>Your nutrition journey starts here.</h2><p>Set up your profile and connect Gemini when you're ready to log your first meal.</p><div className="setup-fields"><NumberField label="Age" value={profile.age} suffix="years" onChange={v=>setProfile(p=>({...p,age:+v}))}/><NumberField label="Height" value={profile.height} suffix="cm" onChange={v=>setProfile(p=>({...p,height:+v}))}/><NumberField label="Current weight" value={profile.weight} suffix="kg" onChange={v=>setProfile(p=>({...p,weight:+v}))}/><NumberField label="Target weight" value={profile.targetWeight} suffix="kg" onChange={v=>setProfile(p=>({...p,targetWeight:+v}))}/></div><label className="field-label">YOUR PRIMARY GOAL</label><div className="goal-options setup-goals">{[['lose','Lose weight',ArrowDownRight],['maintain','Maintain',Scale],['gain','Gain weight',ArrowUpRight]].map(([v,l,I])=><button key={v} className={profile.goal===v?'chosen':''} onClick={()=>setProfile(p=>({...p,goal:v}))}><I size={17}/><b>{l}</b></button>)}</div><button className="primary-btn full-btn" onClick={()=>{setShowSetup(false);setPage('Settings');}}>Continue to AI setup <ChevronRight size={16}/></button><button className="skip-btn" onClick={()=>{setShowSetup(false);}}>I'll configure this later</button><small className="setup-foot">You can change all of these details later in Goals and Settings.</small></div></div>}
    {notice&&<div className="toast"><Check size={16}/>{notice}</div>}
  </div>;
}
function MealRow({meal,onDelete,showDate=false}){const Icon=meal.category==='Breakfast'?Coffee:meal.category==='Snack'?Apple:Utensils;return <div className="meal-row"><div className="meal-type-icon"><Icon size={18}/></div><div className="meal-info"><b>{meal.name}</b><small>{showDate?new Date(meal.date+'T00:00:00').toLocaleDateString('en',{month:'short',day:'numeric'})+' · ':''}{meal.category} · {meal.time}</small></div><div className="meal-macros"><b>{fmt(meal.calories)} kcal</b><small>{fmt(meal.protein)}g protein · {fmt(meal.carbs)}g carbs</small></div><span className={`quality-pill ${meal.quality==='Good'?'good':''}`}>{meal.quality||'Logged'}</span><button className="icon-btn delete-btn" title="Delete meal" onClick={()=>onDelete(meal.id)}><Trash2 size={15}/></button></div>}
function EmptyState({icon:Icon,title,desc,action,onClick}){return <div className="empty-state"><div><Icon size={22}/></div><b>{title}</b><p>{desc}</p>{action&&<button className="secondary-btn" onClick={onClick}>{action}</button>}</div>}
function StatCard({icon:Icon,label,value,sub,color}){return <div className="card stat-card"><div className="card-head"><span>{label}</span><div className={`metric-icon ${color}`}><Icon size={17}/></div></div><strong>{value}</strong><small>{sub}</small></div>}
function NumberField({label,value,suffix,disabled=false,onChange}){return <label className="number-field"><span>{label}</span><div><input type="number" value={value} disabled={disabled} onChange={e=>onChange(e.target.value)}/><small>{suffix}</small></div></label>}

createRoot(document.getElementById('root')).render(<App/>);
