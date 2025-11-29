

document.addEventListener('DOMContentLoaded', function() {
    const tabButtons = document.querySelectorAll('.tab-btn');
    const authForms = document.querySelectorAll('.auth-form');
    
    tabButtons.forEach(btn => {
        btn.addEventListener('click', function() {
            const targetTab = this.dataset.tab;
            
            tabButtons.forEach(b => b.classList.remove('active'));
            this.classList.add('active');
            
            authForms.forEach(form => {
                form.classList.remove('active');
            });
            document.getElementById(targetTab + '-tab').classList.add('active');
            
            document.querySelectorAll('.error-message').forEach(msg => {
                msg.classList.remove('show');
                msg.textContent = '';
            });
        });
    });
    
    const loginForm = document.getElementById('login-form');
    if (loginForm) {
        loginForm.addEventListener('submit', handleLogin);
    }
    
    const registerForm = document.getElementById('register-form');
    if (registerForm) {
        registerForm.addEventListener('submit', handleRegister);
    }
    
    if (isAuthenticated()) {
        window.location.href = 'dashboard.html';
    }
});

async function handleLogin(e) {
    e.preventDefault();
    const errorDiv = document.getElementById('login-error');
    errorDiv.classList.remove('show');
    
    const username = document.getElementById('login-username').value;
    const password = document.getElementById('login-password').value;
    
    try {
        const user = await AuthAPI.login(username, password);
        window.location.href = 'dashboard.html';
    } catch (error) {
        errorDiv.textContent = error.message || 'Login failed';
        errorDiv.classList.add('show');
    }
}

async function handleRegister(e) {
    e.preventDefault();
    const errorDiv = document.getElementById('register-error');
    errorDiv.classList.remove('show');
    
    const username = document.getElementById('register-username').value;
    const password = document.getElementById('register-password').value;
    const passwordConfirm = document.getElementById('register-password-confirm').value;
    
    if (password !== passwordConfirm) {
        errorDiv.textContent = 'Passwords do not match.';
        errorDiv.classList.add('show');
        return;
    }
    
    try {
        const user = await AuthAPI.register(username, password);
        window.location.href = 'dashboard.html';
    } catch (error) {
        errorDiv.textContent = error.message || 'Registration failed';
        errorDiv.classList.add('show');
    }
}


