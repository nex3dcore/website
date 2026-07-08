document.addEventListener('DOMContentLoaded', () => {
    // 1. DOM Elements
    const spotlight = document.querySelector('.spotlight');
    const nexWord = document.querySelector('.word.nex');
    const designContainer = document.querySelector('.design-container');
    const staticPart = document.querySelector('.subtitle-static');
    const word1 = document.querySelector('.word-1');
    const word2 = document.querySelector('.word-2');
    const buttonContainer = document.querySelector('.button-container');
    const downloadBtn = document.getElementById('downloadBtn');
    const downloadModal = document.getElementById('downloadModal');
    const closeBtn = document.getElementById('closeBtn');
    const modalBackdrop = document.querySelector('.modal-backdrop');
    const dlWindows = document.getElementById('dlWindows');
    const dlMacIntel = document.getElementById('dlMacIntel');
    const dlMacSilicon = document.getElementById('dlMacSilicon');
    const dlLinux = document.getElementById('dlLinux');

    // 2. Sequential Animation Timings
    setTimeout(() => {
        if (nexWord) nexWord.classList.add('animate-active');
    }, 300);

    setTimeout(() => {
        if (designContainer) designContainer.classList.add('animate-active');
    }, 900);

    // Initial subtitle "for architects" appears
    setTimeout(() => {
        if (staticPart) staticPart.classList.add('active');
        if (word1) word1.classList.add('active');
    }, 1500);

    setTimeout(() => {
        if (buttonContainer) buttonContainer.classList.add('animate-active');
    }, 2100);

    // Swap "for architects" with "for us" after a brief delay
    setTimeout(() => {
        if (word1) {
            word1.classList.remove('active');
            word1.classList.add('exit');
        }
        if (word2) {
            word2.classList.add('active');
        }
    }, 4300); // 1500ms + 2800ms display delay

    // 3. Interactive Mouse Spotlight
    document.addEventListener('mousemove', (e) => {
        const x = e.clientX;
        const y = e.clientY;
        
        // Update CSS variables on document element for smooth performance
        document.documentElement.style.setProperty('--spotlight-x', `${x}px`);
        document.documentElement.style.setProperty('--spotlight-y', `${y}px`);
    });

    // Touch support for spotlight
    document.addEventListener('touchmove', (e) => {
        if (e.touches && e.touches[0]) {
            const x = e.touches[0].clientX;
            const y = e.touches[0].clientY;
            document.documentElement.style.setProperty('--spotlight-x', `${x}px`);
            document.documentElement.style.setProperty('--spotlight-y', `${y}px`);
        }
    });

    // 4. Modal Interactions
    const openModal = (e) => {
        e.preventDefault();
        downloadModal.classList.add('active');
        document.body.style.overflow = 'hidden'; // Disable background scrolling
    };

    const closeModal = () => {
        downloadModal.classList.remove('active');
        document.body.style.overflow = ''; // Restore scrolling
    };

    if (downloadBtn) downloadBtn.addEventListener('click', openModal);
    if (closeBtn) closeBtn.addEventListener('click', closeModal);
    if (modalBackdrop) modalBackdrop.addEventListener('click', closeModal);

    // Escape key to close modal
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && downloadModal.classList.contains('active')) {
            closeModal();
        }
    });

    // 5. Fetch latest version and update download URLs dynamically
    const updateDownloadLinks = async () => {
        try {
            const response = await fetch('https://download.nex3dcore.com/latest.json');
            if (!response.ok) throw new Error('Failed to fetch updater json');
            const data = await response.json();
            const version = data.version;
            
            const versionDesc = document.getElementById('appVersionDesc');
            if (versionDesc) {
                versionDesc.textContent = `Select your operating system to download NexDesign v${version}.`;
            }

            if (dlWindows) dlWindows.href = `https://download.nex3dcore.com/targets/windows-x86_64/NexDesign_${version}_x64-setup.exe`;
            if (dlMacIntel) dlMacIntel.href = `https://download.nex3dcore.com/targets/darwin-x86_64/NexDesign_${version}_x64.dmg`;
            if (dlMacSilicon) dlMacSilicon.href = `https://download.nex3dcore.com/targets/darwin-aarch64/NexDesign_${version}_aarch64.dmg`;
            if (dlLinux) dlLinux.href = `https://download.nex3dcore.com/targets/linux-x86_64/nexdesign_${version}_amd64.AppImage`;
        } catch (error) {
            console.error('Error fetching latest version from R2:', error);
            // Fallback to default version defined in index.html
        }
    };

    updateDownloadLinks();

    // Visual feedback helper on click
    const addDownloadFeedback = (element) => {
        if (!element) return;
        element.addEventListener('click', () => {
            const originalHTML = element.innerHTML;
            element.innerHTML = '<span>Starting download...</span><span class="file-size">Please wait</span>';
            element.style.pointerEvents = 'none';
            setTimeout(() => {
                element.innerHTML = originalHTML;
                element.style.pointerEvents = 'auto';
                closeModal();
            }, 2000);
        });
    };

    addDownloadFeedback(dlWindows);
    addDownloadFeedback(dlMacIntel);
    addDownloadFeedback(dlMacSilicon);
    addDownloadFeedback(dlLinux);
});
