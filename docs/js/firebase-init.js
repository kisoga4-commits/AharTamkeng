(() => {
  'use strict';

  const firebaseConfig = {
    apiKey: 'AIzaSyC4jOmVcZp0HmmDqZCmHufnq2yyoPcvyVM',
    authDomain: 'pakdu-a26c4.firebaseapp.com',
    databaseURL: 'https://pakdu-a26c4-default-rtdb.asia-southeast1.firebasedatabase.app',
    projectId: 'pakdu-a26c4',
    storageBucket: 'pakdu-a26c4.firebasestorage.app',
    messagingSenderId: '414809008203',
    appId: '1:414809008203:web:757dceafa78d91900d85ce'
  };

  window.FakduFirebase = {
    ...(window.FakduFirebase || {}),
    ready: false,
    config: firebaseConfig
  };
})();
