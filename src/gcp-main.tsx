import React from 'react';
import ReactDOM from 'react-dom/client';
import './theme.generated.css';
import './styles.css';
import { LanguageProvider } from './i18n';
import FirebaseIdentityFactory from './platform/firebase/Factory';
import HostedApp from './modules/gcp/HostedApp';

ReactDOM.createRoot(document.getElementById('root')!).render(<React.StrictMode><LanguageProvider><FirebaseIdentityFactory><HostedApp /></FirebaseIdentityFactory></LanguageProvider></React.StrictMode>);
