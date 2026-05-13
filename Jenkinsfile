pipeline {
    agent {
        docker {
            image 'node:20-alpine'
        }
    }
    stages {
        stage('Checkout') {
            steps {
                checkout scm
            }
        }
        stage('Install') {
            steps {
                sh 'node --version'
                sh 'npm --version'
                echo 'Jenkins is working'
            }
        }
    }
    post {
        always {
            echo 'Pipeline complete'
        }
    }
}
