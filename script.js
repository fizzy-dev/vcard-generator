// --- 1. FIREBASE & CONFIGURATION MODULE -----------------------------------------------------
import { initializeApp } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-app.js";
import { getAuth, signInAnonymously, signInWithCustomToken } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-auth.js";
import { getFirestore, doc, setDoc, getDoc, setLogLevel } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js";

// setLogLevel('Debug'); // Uncomment for verbose Firestore debugging

// Global variables will be undefined in VS Code, allowing local mock mode to activate
const isCanvasEnvironment = typeof __firebase_config !== 'undefined';
        
let firebaseConfig = {};
let initialAuthToken = null;
let isLocalMockMode = false;
        
// Load environment specific configuration or activate mock mode for local development
if (isCanvasEnvironment) {
    firebaseConfig = JSON.parse(__firebase_config);
    initialAuthToken = typeof __initial_auth_token !== 'undefined' ? __initial_auth_token : null;
} else {
    // This is the path executed when running in VS Code/local browser
    console.warn("⚠️ Running locally: Using mock Firebase config. Database read/write skipped.");
    firebaseConfig = { apiKey: "mock-key", projectId: "mock-project-id" };
    isLocalMockMode = true; // Flag to skip network calls
}

const appId = typeof __app_id !== 'undefined' ? __app_id : 'default-app-id';
        
let db, auth;
let isFirebaseInitialized = false;

/**
 * Initializes Firebase services and handles authentication.
 * Skips network calls if in local mock mode.
 */
async function initializeFirebase() {
    if (isFirebaseInitialized) return true;

    const appContainer = document.getElementById('app-container');
    
    if (isLocalMockMode) {
        isFirebaseInitialized = true;
        return true; 
    }

    if (!firebaseConfig.projectId && !firebaseConfig.apiKey) {
        appContainer.innerHTML = `<div class="text-center p-12 text-red-600">Error: Firebase configuration missing.</div>`;
        return false;
    }

    try {
        const app = initializeApp(firebaseConfig);
        db = getFirestore(app);
        auth = getAuth(app);
        
        if (initialAuthToken) {
            await signInWithCustomToken(auth, initialAuthToken);
        } else {
            await signInAnonymously(auth);
        }

        isFirebaseInitialized = true;
        console.log("✅ Firebase initialized and authenticated successfully.");
        return true;
    } catch (error) {
        appContainer.innerHTML = `<div class="text-center p-12 text-red-600">Firebase Auth Error: ${error.message}</div>`;
        console.error("Firebase initialization/authentication failed:", error);
        return false;
    }
}
        
/**
 * Displays a temporary status message on the generator screen.
 */
function showStatus(message, className) {
    const statusDiv = document.getElementById('statusMessage');
    if (!statusDiv) return;
    
    statusDiv.textContent = message;
    const baseClasses = 'text-center mt-4 p-2 text-sm font-medium rounded-lg transition-opacity duration-300';
    let bgClass = '';
    if (className.includes('text-green')) bgClass = 'bg-green-100';
    else if (className.includes('text-red')) bgClass = 'bg-red-100';
    else bgClass = 'bg-indigo-100';
    
    statusDiv.className = `${baseClasses} ${className} ${bgClass}`;
    statusDiv.classList.remove('hidden');
    setTimeout(() => { statusDiv.classList.add('hidden'); }, 5000);
}

// --- 2. VCard GENERATOR LOGIC MODULE --------------------------------------------------------
        
const VCF_MAPPING = {
    'ID': ['id', 'contact id', 'record id'], 
    'Name': ['name', 'full name', 'contact name', 'fullname'],
    'Phone': ['phone', 'mobile', 'cell', 'telephone', 'tel'],
    'Email': ['email', 'e-mail', 'mail'],
    'Organization': ['organization', 'company', 'org', 'firm'],
    'Title': ['title', 'job title', 'position', 'job']
};

/**
 * Creates a VCF 3.0 formatted string from a contact object.
 */
function createVCard(contact) {
    const name = contact['Name'] || '';
    const phone = contact['Phone'] || '';
    const email = contact['Email'] || '';
    const org = contact['Organization'] || '';
    const title = contact['Title'] || '';

    if (!name && !phone && !email) return null;

    let vcf = "BEGIN:VCARD\nVERSION:3.0";
            
    if (name) {
        const parts = name.split(/\s+/);
        const givenName = parts[0];
        const familyName = parts.slice(1).join(' ');
        vcf += `\nN:${familyName};${givenName};;;`; 
        vcf += `\nFN:${name}`;
    } else {
        vcf += `\nFN:${phone || email}`;
    }

    if (title) vcf += `\nTITLE:${title}`;
    if (org) vcf += `\nORG:${org}`;
    // Replace semicolons/commas to prevent VCF format issues
    if (phone) vcf += `\nTEL;TYPE=CELL,VOICE:${phone.replace(/;/g, '\\;').replace(/,/g, '\\,')}`;
    if (email) vcf += `\nEMAIL;TYPE=PREF,INTERNET:${email.replace(/;/g, '\\;').replace(/,/g, '\\,')}`;
            
    vcf += "\nEND:VCARD";
    return vcf;
}

/**
 * Parses the raw CSV text, maps headers, and creates VCard content.
 */
function parseCSV(csvText) {
    const lines = csvText.trim().split('\n').filter(line => line.trim() !== '');
    if (lines.length <= 1) return [];

    const rawHeaders = lines[0].split(',').map(h => h.trim());
    const standardHeaders = rawHeaders.map(rawHeader => {
        const lowerHeader = rawHeader.toLowerCase();
        for (const [standardKey, synonyms] of Object.entries(VCF_MAPPING)) {
            if (synonyms.includes(lowerHeader)) {
                return standardKey;
            }
        }
        return null;
    });
            
    const contacts = [];
            
    for (let i = 1; i < lines.length; i++) {
        // Simple split, assuming no quoted commas in values for simplicity
        const values = lines[i].split(',').map(v => v.trim()); 
        if (values.length !== rawHeaders.length) continue;

        let contact = {};
        let hasVCardData = false;
                
        for (let j = 0; j < standardHeaders.length; j++) {
            const standardKey = standardHeaders[j];
            const value = values[j];
                    
            if (standardKey && value) {
                contact[standardKey] = value;
                if (['Name', 'Phone', 'Email'].includes(standardKey)) { 
                    hasVCardData = true;
                }
            }
        }
                
        if (hasVCardData) {
            if (!contact['ID']) {
               contact['ID'] = `local-${i}`; // Assign temporary ID if missing
            }
            contact.VcfContent = createVCard(contact);
            contacts.push(contact);
        }
    }
    return contacts;
}

/**
 * Saves processed contacts to the public Firestore collection.
 */
async function batchSaveContacts(contacts, templateKey) {
    if (isLocalMockMode || !db) return contacts;

    // Public collection path: artifacts/{appId}/public/data/vcards/{documentId}
    const publicCollectionPath = `artifacts/${appId}/public/data/vcards`; 
    const savedContacts = [];

    for (const contact of contacts) {
        try {
            const docRef = doc(db, publicCollectionPath, contact.ID);
            // Save contact data along with the selected template key
            const dataToSave = { ...contact, Template: templateKey, timestamp: Date.now() };
            await setDoc(docRef, dataToSave, { merge: true });
            savedContacts.push(contact);
        } catch (error) {
            console.error(`❌ Failed to save ${contact.ID}:`, error);
        }
    }
    return savedContacts;
}

/**
 * Renders QR codes linking to the VCard Viewer page.
 */
function generateBatchQRCodes(contacts, templateKey) {
    const outputDiv = document.getElementById('qrcodeOutput');
    if (!outputDiv) return;
    outputDiv.innerHTML = ''; 

    contacts.forEach((contact, index) => {
        // Construct the URL pointing back to this app with the contact ID and template key
        // NOTE: The ID doesn't matter for local testing, only the 't' parameter matters now.
        const qrUrl = `${window.location.origin}${window.location.pathname}?id=${encodeURIComponent(contact.ID)}&t=${templateKey}`;

        if (contact.ID) {
            const qrContainer = document.createElement('div');
            qrContainer.className = 'qr-container';
                    
            const nameDisplay = contact['Name'] || `Contact ${index + 1}`;
                    
            const label = document.createElement('p');
            label.textContent = `${nameDisplay}\n(ID: ${contact.ID})`;
                    
            const qrWrapper = document.createElement('div');
            qrWrapper.className = 'qr-canvas-wrapper p-1 border-2 border-gray-100 rounded-lg';
                    
            qrContainer.appendChild(qrWrapper);
            qrContainer.appendChild(label);
            outputDiv.appendChild(qrContainer);

            // Use the QRCode library to render the QR code
            new QRCode(qrWrapper, {
                text: qrUrl,
                width: 120,
                height: 120,
                colorDark: "#1f2937",
                colorLight: "#ffffff",
                correctLevel: QRCode.CorrectLevel.H
            });
        }
    });

    if (outputDiv.children.length === 0) {
        outputDiv.innerHTML = '<p class="col-span-full text-center text-red-500">No valid contacts found with unique IDs.</p>';
    }
}

/**
 * Main orchestration function for processing the CSV file.
 */
async function processFileAndSave() {
    const processBtn = document.getElementById('processBtn');
    processBtn.disabled = true;
    processBtn.textContent = "Processing... Please wait.";

    const initSuccess = await initializeFirebase();
    const fileInput = document.getElementById('csvFile');
    const files = fileInput.files;
    const templateKey = document.getElementById('templateSelector').value;

    document.getElementById('statusMessage').classList.add('hidden');
    const outputDiv = document.getElementById('qrcodeOutput');
    outputDiv.innerHTML = '<p class="col-span-full text-center text-indigo-500">Processing file...</p>';

    if (files.length === 0) {
        showStatus('Please select a CSV file.', 'text-red-500');
        processBtn.disabled = false;
        processBtn.textContent = "Process CSV, Save Data, and Generate QR Codes";
        return;
    }

    const file = files[0];
    const reader = new FileReader();

    reader.onload = async (e) => {
        try {
            let contacts = parseCSV(e.target.result);
                    
            if (contacts.length === 0) {
                showStatus('No valid contacts found. Check file format/required columns.', 'text-red-500');
                outputDiv.innerHTML = '<p class="col-span-full text-center text-gray-400">Upload a file to start generating VCard QR Codes.</p>';
                return;
            }

            showStatus(`Found ${contacts.length} valid contacts. Preparing action...`, 'text-indigo-600');
                    
            let contactsToGenerate = contacts;
                    
            if (initSuccess && !isLocalMockMode) {
                showStatus(`Found ${contacts.length} valid contacts. Saving to database...`, 'text-indigo-600');
                const savedContacts = await batchSaveContacts(contacts, templateKey);
                contactsToGenerate = savedContacts;
                showStatus(`Successfully processed and saved ${savedContacts.length} contacts!`, 'text-green-600');
            } else {
                showStatus(`Successfully parsed ${contacts.length} contacts! (Database save skipped for local testing)`, 'text-green-600');
            }
                    
            generateBatchQRCodes(contactsToGenerate, templateKey);
                    
        } catch (error) {
            console.error("❌ Processing error:", error);
            showStatus(`Error: ${error.message}`, 'text-red-500');
        } finally {
            processBtn.disabled = false;
            processBtn.textContent = "Process CSV, Save Data, and Generate QR Codes";
        }
    };

    reader.readAsText(file);
}

/**
 * Renders the Generator (default) application view.
 */
function renderGeneratorApp() {
    const appContainer = document.getElementById('app-container');
    appContainer.className = "w-full max-w-4xl pt-4";
    appContainer.innerHTML = `
        <header class="text-center mb-10">
            <h1 class="text-4xl font-extrabold text-gray-800 tracking-tight">Batch VCard QR Code Generator</h1>
            <p class="text-lg text-gray-500 mt-2">Upload a CSV file to generate multiple scannable VCard QR codes for contacts.</p>
        </header>

        <main>
            <div id="utility-container" class="rounded-xl bg-white shadow-xl border border-gray-200 p-6 pt-4">
                <h2 class="text-2xl font-bold mb-4 text-indigo-700">1. Template and Data</h2>

                <div class="space-y-4">
                    <div>
                        <label for="templateSelector" class="block text-sm font-medium text-gray-700 mb-2">Select VCard Page Template:</label>
                        <select id="templateSelector" 
                                class="w-full p-3 border border-gray-300 rounded-lg focus:ring-indigo-500 focus:border-indigo-500 text-sm bg-white shadow-sm">
                            <option value="A" selected>Template A: Teal Theme (Professional)</option>
                            <option value="B">Template B: Blue Theme (Minimalist)</option>
                            <option value="C">Template C: Indigo Theme (Iconic)</option>
                        </select>
                    </div>

                    <div>
                        <label for="csvFile" class="block text-sm font-medium text-gray-700 mb-2">Upload Contact Data (.CSV):</label>
                        <input type="file" id="csvFile" accept=".csv"
                            class="w-full text-sm text-gray-500 file:mr-4 file:py-2 file:px-4 file:rounded-full file:border-0 file:text-sm file:font-semibold file:bg-indigo-50 file:text-indigo-700 hover:file:bg-indigo-100 transition duration-150">
                        
                        <p class="text-sm text-gray-600 mt-2">
                            <span class="font-semibold">Flexible Headers:</span> ID (required for saving), Name, Phone, Email, Organization, Title are supported.
                        </p>
                    </div>

                    <button onclick="window.processFileAndSave()" id="processBtn"
                        class="w-full py-3 px-4 bg-indigo-600 text-white font-semibold rounded-lg hover:bg-indigo-700 transition duration-150 shadow-md disabled:bg-indigo-400">
                        Process CSV, Save Data, and Generate QR Codes
                    </button>
                </div>
                
                <div id="statusMessage" class="text-center mt-4 text-sm font-medium text-red-500 hidden"></div>

                <h2 class="text-2xl font-bold mt-8 mb-4 text-green-700">2. Generated QR Codes (Links to VCard Page)</h2>

                <div id="qrcodeOutput" class="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-4 p-4 bg-gray-50 rounded-lg min-h-[150px] items-start justify-center">
                    <p class="col-span-full text-center text-gray-400">Upload a file to start generating VCard QR Codes.</p>
                </div>
            </div>
        </main>
    `;
    // Expose function globally for the inline onclick handler in the generated HTML
    window.processFileAndSave = processFileAndSave;
}


// --- 3. VCard VIEWER LOGIC MODULE (Templates & Download) ------------------------------------

/**
 * Initiates the VCF file download for the contact.
 * Exposed to window for use in template onclick handlers.
 */
window.downloadVcf = function(vcfText, name) {
    const cleanVcfText = vcfText.replace(/\\n/g, '\n');
    const blob = new Blob([cleanVcfText], { type: 'text/vcard;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = (name.replace(/\s/g, '_') || 'contact') + '.vcf';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
};

// SVG Icons for use in templates (simplified Lucide-style icons)
const icons = {
    phone: `<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.63A2 2 0 0 1 4.08 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z"/></svg>`,
    mail: `<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="20" height="16" x="2" y="4" rx="2"/><path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7"/></svg>`,
    building: `<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="2" width="20" height="20" rx="2" ry="2"/><path d="M12 2v20"/><path d="M2 12h20"/><path d="M12 2v20"/><path d="M2 12h20"/><path d="M6 6h6v6H6z"/></svg>`
};

// Utility to safely inject values into the template string
const esc = (s) => s ? s.replace(/'/g, '&#39;').replace(/"/g, '&quot;') : 'N/A';

// --- Local Mock Data for Template Testing ---
const mockContactData = (id, template) => ({
    ID: id,
    Name: "Alex R. Henderson",
    Title: "Lead Software Architect",
    Organization: "Acme Tech Solutions",
    Phone: "+1 (555) 123-4567",
    Email: "alex.henderson@acmetech.com",
    VcfContent: createVCard({
        Name: "Alex R. Henderson",
        Title: "Lead Software Architect",
        Organization: "Acme Tech Solutions",
        Phone: "+1 (555) 123-4567",
        Email: "alex.henderson@acmetech.com"
    }),
    Template: template,
});


// HTML Template Definitions
const TEMPLATES = {
    // Template A: Teal Theme (Professional, Full Banner)
    A: (data) => `
        <div class="template-a-bg h-40 relative rounded-t-xl overflow-hidden">
            <div class="absolute inset-0 flex items-center justify-center text-white font-semibold text-3xl opacity-80">
                ${esc(data.Organization || 'Business Contact')}
            </div>
        </div>
        <div class="relative -mt-16 flex justify-center">
            <div class="w-32 h-32 bg-white rounded-full border-4 border-white shadow-xl flex items-center justify-center text-xl text-teal-600 font-bold">
                ${(data.Name || 'C').charAt(0)}
            </div>
        </div>
        <div class="text-center p-4 pt-2">
            <h1 class="text-3xl font-bold text-gray-800">${esc(data.Name || 'N/A')}</h1>
            <p class="text-md text-teal-600 font-semibold mt-1">${esc(data.Title || 'Contact Details')}</p>
            <p class="text-sm text-gray-500">${esc(data.Organization || '')}</p>
        </div>
        
        <div class="px-6 pb-6 space-y-4">
            <!-- Contact Links -->
            <a href="tel:${esc(data.Phone)}" class="flex items-center p-3 border-b border-gray-100 hover:bg-gray-50 transition duration-150 rounded-lg">
                <div class="text-teal-500 mr-4">${icons.phone}</div>
                <div>
                    <div class="text-sm font-medium text-gray-700">Phone (Mobile)</div>
                    <div class="text-md text-gray-900">${esc(data.Phone || 'N/A')}</div>
                </div>
            </a>
            <a href="mailto:${esc(data.Email)}" class="flex items-center p-3 border-b border-gray-100 hover:bg-gray-50 transition duration-150 rounded-lg">
                <div class="text-teal-500 mr-4">${icons.mail}</div>
                <div>
                    <div class="text-sm font-medium text-gray-700">Email Address</div>
                    <div class="text-md text-gray-900 truncate">${esc(data.Email || 'N/A')}</div>
                </div>
            </a>
            <a href="#" class="flex items-center p-3 border-b border-gray-100 hover:bg-gray-50 transition duration-150 rounded-lg">
                <div class="text-teal-500 mr-4">${icons.building}</div>
                <div>
                    <div class="text-sm font-medium text-gray-700">Organization</div>
                    <div class="text-md text-gray-900">${esc(data.Organization || 'N/A')}</div>
                </div>
            </a>

            <!-- Download Button -->
            <button onclick="window.downloadVcf(\`${data.VcfContent.replace(/`/g, '\\`').replace(/\n/g, '\\n')}\`, '${esc(data.Name)}')"
                    class="w-full mt-6 py-4 px-4 bg-teal-600 text-white font-semibold rounded-xl text-lg hover:bg-teal-700 transition duration-150 shadow-lg shadow-teal-300/50">
                Download Contact Card
            </button>
            <div class="mt-4 text-center text-xs text-gray-400">Card ID: ${esc(data.ID)}</div>
        </div>
    `,
    // Template B: Blue Theme (Minimalist, Modern)
    B: (data) => `
        <div class="template-b-bg h-32 relative rounded-t-xl"></div>
        <div class="relative -mt-16 flex justify-center">
            <div class="w-32 h-32 bg-white rounded-full border-4 border-gray-200 shadow-xl flex items-center justify-center text-xl text-blue-700 font-bold">
                ${(data.Name || 'C').charAt(0)}
            </div>
        </div>
        <div class="text-center p-6 pt-2">
            <h1 class="text-3xl font-extrabold text-gray-800">${esc(data.Name || 'N/A')}</h1>
            <p class="text-md text-gray-600 mt-1">${esc(data.Title || 'Contact Details')}</p>
            <p class="text-sm text-gray-500">${esc(data.Organization || '')}</p>
        </div>
        <div class="px-6 pb-6 space-y-4">
            <!-- Contact Links -->
            <div class="flex items-center p-3 border-2 border-blue-100 bg-blue-50 rounded-lg">
                <div class="text-blue-600 mr-4">${icons.phone}</div>
                <span class="font-medium text-gray-700 flex-1">Mobile:</span>
                <a href="tel:${esc(data.Phone)}" class="text-blue-700 hover:underline">${esc(data.Phone || 'N/A')}</a>
            </div>
            <div class="flex items-center p-3 border-2 border-blue-100 bg-blue-50 rounded-lg">
                <div class="text-blue-600 mr-4">${icons.mail}</div>
                <span class="font-medium text-gray-700 flex-1">Email:</span>
                <a href="mailto:${esc(data.Email)}" class="text-blue-700 hover:underline truncate">${esc(data.Email || 'N/A')}</a>
            </div>
            
            <!-- Download Button -->
            <button onclick="window.downloadVcf(\`${data.VcfContent.replace(/`/g, '\\`').replace(/\n/g, '\\n')}\`, '${esc(data.Name)}')"
                    class="w-full mt-6 py-4 px-4 bg-blue-700 text-white font-semibold rounded-xl text-lg hover:bg-blue-800 transition duration-150 shadow-lg shadow-blue-300/50">
                Download Contact
            </button>
            <div class="mt-4 text-center text-xs text-gray-400">Card ID: ${esc(data.ID)}</div>
        </div>
    `,
    // Template C: Indigo Theme (Iconic, Clean Lines)
    C: (data) => `
        <div class="template-c-header h-36 relative rounded-t-xl overflow-hidden">
            <div class="absolute inset-0 bg-black opacity-10"></div>
        </div>
        <div class="relative -mt-16 flex justify-center">
            <div class="w-32 h-32 bg-white rounded-full border-4 border-indigo-500 shadow-xl flex items-center justify-center text-xl text-indigo-700 font-bold">
                ${(data.Organization || 'O').charAt(0)}
            </div>
        </div>
        <div class="text-center p-4 pt-2">
            <h1 class="text-3xl font-bold text-gray-900">${esc(data.Name || 'N/A')}</h1>
            <p class="text-md text-indigo-700 font-medium">${esc(data.Organization || 'N/A')}</p>
            <p class="text-sm text-gray-500">${esc(data.Title || 'Position')}</p>
        </div>
        <div class="px-6 py-6 space-y-4">
            <!-- Contact Links -->
            <div class="flex items-center p-2 border-b border-indigo-100">
                <div class="text-indigo-600 mr-4">${icons.phone}</div>
                <div class="flex-1 text-sm font-medium text-gray-700">Mobile</div>
                <a href="tel:${esc(data.Phone)}" class="text-indigo-600 hover:underline">${esc(data.Phone || 'N/A')}</a>
            </div>
            <div class="flex items-center p-2 border-b border-indigo-100">
                <div class="text-indigo-600 mr-4">${icons.mail}</div>
                <div class="flex-1 text-sm font-medium text-gray-700">Email</div>
                <a href="mailto:${esc(data.Email)}" class="text-indigo-600 hover:underline truncate">${esc(data.Email || 'N/A')}</a>
            </div>
        </div>
        <div class="p-6 pt-0">
            <!-- Download Button -->
            <button onclick="window.downloadVcf(\`${data.VcfContent.replace(/`/g, '\\`').replace(/\n/g, '\\n')}\`, '${esc(data.Name)}')"
                    class="w-full py-3 px-4 bg-indigo-600 text-white font-semibold rounded-lg hover:bg-indigo-700 transition duration-150 shadow-md">
                Save Contact to Address Book
            </button>
            <div class="mt-4 text-center text-xs text-gray-400">Card ID: ${esc(data.ID)}</div>
        </div>
    `,
};


/**
 * Main function to load and render a VCard for a scanned QR code.
 */
async function loadVCard(contactId, templateKey) {
    const outputDiv = document.getElementById('app-container');
    outputDiv.className = "w-full max-w-sm";
    outputDiv.innerHTML = `<div id="vcard-output" class="w-full max-w-sm bg-white rounded-xl shadow-2xl overflow-hidden relative p-4">Loading...</div>`; 
            
    const initSuccess = await initializeFirebase();
    const vCardOutputDiv = document.getElementById('vcard-output');
            
    if (!contactId) {
        vCardOutputDiv.innerHTML = '<div class="text-center p-12 text-red-600">Error: Contact ID not specified in URL.</div>';
        return;
    }

    // --- FIX APPLIED HERE ---
    let data;
    let usedTemplateKey = templateKey;

    if (isLocalMockMode || !db) {
        // --- 1. LOCAL TESTING FALLBACK (NEW LOGIC) ---
        console.warn("⚠️ Using local mock data to render VCard template.");
        data = mockContactData(contactId, templateKey);
        usedTemplateKey = templateKey;
    } else if (!initSuccess) {
        // --- 2. AUTH FAILURE (ONLY IN DEPLOYED ENVIRONMENT) ---
        vCardOutputDiv.innerHTML = '<div class="text-center p-12 text-red-600">Failed to initialize database connection.</div>';
        return;
    } else {
        // --- 3. PRODUCTION DATABASE FETCH ---
        try {
            const vCardDocRef = doc(db, `artifacts/${appId}/public/data/vcards`, contactId);
            const vCardDoc = await getDoc(vCardDocRef);
            
            if (!vCardDoc.exists()) {
                vCardOutputDiv.innerHTML = `<div class="text-center p-12 text-red-600">Error: Contact with ID "${contactId}" not found in the database.</div>`;
                return;
            }
            
            data = vCardDoc.data();
            usedTemplateKey = data.Template || templateKey;

        } catch (error) {
            console.error("Failed to load VCard:", error);
            vCardOutputDiv.innerHTML = `<div class="text-center p-12 text-red-600">Database Load Error: ${error.message}</div>`;
            return;
        }
    }
    
    // --- TEMPLATE RENDERING (Now executes for local mock data as well) ---
    const template = TEMPLATES[usedTemplateKey];
            
    if (template) {
        vCardOutputDiv.innerHTML = template(data);
    } else {
        vCardOutputDiv.innerHTML = '<div class="text-center p-12 text-red-600">Error: Invalid template selected.</div>';
    }
}


// --- 4. MAIN APPLICATION ENTRY POINT --------------------------------------------------------

document.addEventListener('DOMContentLoaded', () => {
    const urlParams = new URLSearchParams(window.location.search);
    const contactId = urlParams.get('id');
    const templateKey = urlParams.get('t') || 'A';
            
    if (contactId) {
        // VCard Viewer Mode: QR code was scanned
        loadVCard(contactId, templateKey);
    } else {
        // Batch Generator Mode: default view
        renderGeneratorApp();
    }
});