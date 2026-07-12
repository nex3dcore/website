import '../style.css';

// Interactive Mouse Spotlight
document.addEventListener('mousemove', (e) => {
    const x = e.clientX;
    const y = e.clientY;
    document.documentElement.style.setProperty('--spotlight-x', `${x}px`);
    document.documentElement.style.setProperty('--spotlight-y', `${y}px`);
});

// Wizard State
let currentStepNum = 1;
let selectedPlan = 'free';
let userEmail = '';

function updateStepUI() {
    // Hide all steps
    document.querySelectorAll('.wizard-step').forEach(step => step.classList.remove('active'));
    // Show current step
    document.getElementById(`step${currentStepNum}`).classList.add('active');

    // Manage Dots
    for(let i=1; i<=4; i++) {
        const dot = document.getElementById(`dot${i}`);
        if (i < currentStepNum) {
            dot.classList.add('completed');
            dot.classList.remove('active');
        } else if (i === currentStepNum) {
            dot.classList.add('active');
            dot.classList.remove('completed');
        } else {
            dot.classList.remove('active', 'completed');
        }
    }

    // Adjust width of card container based on step
    const container = document.getElementById('cardContainer');
    if (currentStepNum === 2) {
        container.classList.add('wide');
    } else {
        container.classList.remove('wide');
    }
}

window.nextStep = function() {
    if (currentStepNum < 4) {
        currentStepNum++;
        updateStepUI();
    }
}

window.prevStep = function() {
    if (currentStepNum > 1) {
        currentStepNum--;
        updateStepUI();
    }
}

window.selectPlan = function(plan) {
    selectedPlan = plan;
    document.querySelectorAll('.plan-card').forEach(card => card.classList.remove('selected'));
    
    if (plan === 'free') {
        document.getElementById('cardFree').classList.add('selected');
    } else if (plan === 'student') {
        document.getElementById('cardStudent').classList.add('selected');
    } else if (plan === 'pro') {
        document.getElementById('cardPro').classList.add('selected');
    }
}

window.handleRegistrationSubmit = function() {
    const emailInput = document.getElementById('reg-email').value;
    const passInput = document.getElementById('reg-password').value;

    if (!emailInput || !emailInput.includes('@')) {
        alert('Lütfen geçerli bir e-posta adresi girin.');
        return;
    }
    if (passInput.length < 4) {
        alert('Şifre en az 4 karakter olmalıdır.');
        return;
    }

    userEmail = emailInput;
    window.nextStep();
}

window.handlePlanSelectionSubmit = function() {
    if (selectedPlan === 'pro') {
        // Pro needs checkout (Step 3)
        window.nextStep();
    } else {
        // Free & Student skip Step 3 (No credit card needed)
        currentStepNum = 4;
        showSuccessScreen();
        updateStepUI();
    }
}

window.handlePaymentSubmit = function() {
    const ccNum = document.getElementById('cc-num').value;
    const ccExp = document.getElementById('cc-exp').value;
    const ccCvc = document.getElementById('cc-cvc').value;

    if (!ccNum || !ccExp || !ccCvc) {
        alert('Lütfen ödeme kartı alanlarını eksiksiz doldurun.');
        return;
    }

    const payBtn = document.getElementById('payBtn');
    payBtn.innerText = 'İşleniyor...';
    payBtn.disabled = true;

    setTimeout(() => {
        currentStepNum = 4;
        showSuccessScreen();
        updateStepUI();
    }, 1500);
}

function showSuccessScreen() {
    document.getElementById('successEmail').innerText = userEmail;
    
    let planText = 'Indie Ücretsiz Sürüm';
    if (selectedPlan === 'student') {
        planText = 'Öğrenci Sürümü';
    } else if (selectedPlan === 'pro') {
        planText = 'Premium Pro Sürümü';
    }
    
    document.getElementById('successPlan').innerText = planText;
}
