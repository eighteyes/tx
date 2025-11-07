# Leadership
## Features to Market
Features taking too long to get to market. Sales would promise a feature to close a contract, nobody was managing these features. Took 9 months to deliver a feature and demonstrate value for customers. I worked with sales to figure out how their features would fit in the roadmap, or worked with the customers directly to figure out an alignment between their needs and where we were going. Maintain focus, avoid over-promising.

Strategies for mediating between technical teams and sales teams.
Understand both Perspectives with clear communication
Prioritize Issues Together
Provide Technical Liaisons for features with sales
Created roadmap shared document
Managed all work and milestone progress in JIRA, managed during agile sprint sdlc. 

Process: Make a feedback loop instead of having sales people reach out to their favorite engineer. I would be on the sales team meetings where they were discussing their pipeline and identify the lift needed to incorporate features from customers. I would validate this information with the development team during our meetings, both to get them excited about where we were going and to get some feedback on ideas we could bring to customers. 

Example: In an age distribution, we were offering young, young adult, adult and senior. A customer asked us for customizable buckets. Instead of offering each customer customizable buckets, we standardized around the guidelines for DOOH, which met their guidelines and was on our roadmap towards programmable real-time bidding integrations.

Outcome: Reduce lead time for new features from 9 months to 1 month.

# Engineering
## Real-estate
Met with clients and analysts to outline product. Wove together 12 different datasets from city, county and state governments to find information relevant for a commercial real estate transaction, including, the goal of the product, the true owner of a given building. True ownership was critical for the product because it let them validate ownership without spending weeks of manual analysis. We got this process down from 2-3 weeks to 30 seconds with 99% accuracy. 

Strategies:
- Outline critical steps in analyst workflow and prototype in a graph database.
	- Lessons Learned: #bad-decisions
		- Graphs work better for querying then creation. 
		- Needed a step-by-step, not an outline with objectives. 
- Led team to build initial MVP and I worked on the data component, which was eventually delivered in Node.
	- Lesson Learned:
		- JavaScript is not-performant at delivering lots of data, use Python and dedicated data processing frameworks. Single threaded, memory constraints, slow at math, garbage collection hits performance. 

# Energy
Took sole ownership of a prototype built by data engineers and phds to bring to market. Ingested 320k IoT endpoints creating about half a billion records a day, or 1/10th terabyte of data a day.

Self-started and: 
- Added monitoring , observation and deployment scripts, instead of manual deployments. 
- Created an SDK for future developments, consolidated codebase into modular architecture.
- Worked with clients including Amazon, the DoE, state and county governments, insurance companies and commercial utilities to determine use cases, create integrations and generate reports.
- 
