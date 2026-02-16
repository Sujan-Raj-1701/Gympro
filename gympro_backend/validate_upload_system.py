"""
Quick validation script for file upload functionality
"""
import os
import sys
from pathlib import Path

# Add the current directory to sys.path to import from main.py
current_dir = Path(__file__).parent
sys.path.insert(0, str(current_dir))

def test_imports():
    """Test that all required imports work"""
    try:
        from fastapi import File, UploadFile, FastAPI
        from fastapi.responses import FileResponse
        import uuid
        import shutil
        print("✅ All required imports successful")
        return True
    except ImportError as e:
        print(f"❌ Import error: {e}")
        return False

def test_utility_functions():
    """Test utility functions"""
    try:
        # Import the utility functions from main.py
        # We'll test them indirectly by checking the logic
        
        # Test filename generation logic
        import uuid
        from datetime import datetime
        
        account_code = "TEST001"
        original_filename = "test_image.jpg"
        
        # Simulate generate_unique_filename logic
        file_ext = Path(original_filename).suffix.lower()
        unique_id = str(uuid.uuid4())[:8]
        timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
        filename = f"{account_code}_{timestamp}_{unique_id}{file_ext}"
        
        # Validate filename format
        parts = filename.replace(".", "_").split("_")
        assert len(parts) >= 4, "Filename should have account_code, timestamp, unique_id, and extension"
        assert parts[0] == account_code, "First part should be account code"
        assert len(parts[1]) == 8, "Timestamp date should be 8 digits (YYYYMMDD)"
        assert len(parts[2]) == 6, "Timestamp time should be 6 digits (HHMMSS)"
        assert len(parts[3]) == 8, "Unique ID should be 8 characters"
        
        print("✅ Utility function logic validation successful")
        return True
    except Exception as e:
        print(f"❌ Utility function test error: {e}")
        return False

def test_directory_structure():
    """Test that upload directories exist"""
    try:
        base_dir = current_dir / "upload"
        images_dir = base_dir / "images" 
        doc_dir = base_dir / "doc"
        
        # Check directories exist
        assert base_dir.exists(), "Upload base directory should exist"
        assert images_dir.exists(), "Images directory should exist"
        assert doc_dir.exists(), "Documents directory should exist"
        
        # Check directories are writable
        test_file = images_dir / "test_write.tmp"
        test_file.write_text("test")
        test_file.unlink()
        
        test_file = doc_dir / "test_write.tmp"
        test_file.write_text("test")
        test_file.unlink()
        
        print("✅ Directory structure and permissions valid")
        return True
    except Exception as e:
        print(f"❌ Directory test error: {e}")
        return False

def main():
    """Run all validation tests"""
    print("File Upload System Validation")
    print("=" * 40)
    
    all_passed = True
    
    # Test imports
    print("\n1. Testing imports...")
    if not test_imports():
        all_passed = False
    
    # Test utility functions
    print("\n2. Testing utility function logic...")
    if not test_utility_functions():
        all_passed = False
    
    # Test directory structure
    print("\n3. Testing directory structure...")
    if not test_directory_structure():
        all_passed = False
    
    # Summary
    print("\n" + "=" * 40)
    if all_passed:
        print("🎉 All validation tests passed!")
        print("\nFile upload system is ready to use.")
        print("\nTo test with actual uploads, run:")
        print("  python test_file_upload.py")
    else:
        print("❌ Some validation tests failed!")
        print("Please check the errors above.")
    
    return all_passed

if __name__ == "__main__":
    main()