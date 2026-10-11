import React from 'react';
import ReactDOM from 'react-dom/client';
import './theme.generated.css';
import './styles.css';
import { LanguageProvider } from './i18n';
import FirebaseIdentityFactory from './identity/firebase/Factory';
import Routes from './console/Routes';

ReactDOM.createRoot(document.getElementById('root')!).render(<React.StrictMode><LanguageProvider><FirebaseIdentityFactory><Routes /></FirebaseIdentityFactory></LanguageProvider></React.StrictMode>);
